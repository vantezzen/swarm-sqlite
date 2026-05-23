import * as VFS from "wa-sqlite"
import debugging from "debug"
import EventEmitter from "events"
import TransferStats from "./TransferStats"

const debug = debugging("swarm-sqlite:Filesystem")

export type MaybePromise<T> = T | Promise<T>
/** A SQLite result code (e.g. `SQLITE_OK`, `SQLITE_CANTOPEN`). */
export type SqliteResultCode = number

const DEFAULT_SECTOR_SIZE = 512
const UTF8_ENCODER = new TextEncoder()
const UINT32_RANGE = 0x1_0000_0000

interface WasmModuleLike {
  UTF8ToString(ptr: number): string
  HEAPU8: Uint8Array
}

interface OpenFile {
  readonly name: string
  readonly flags: number
}

/**
 * Abstract base class for a wa-sqlite VFS implementation.
 * The shape of the public `x*` methods matches wa-sqlite's `SQLiteVFS`
 * interface.
 */
export abstract class Filesystem {
  /** Name SQLite will refer to this VFS by. */
  readonly name: string

  /**
   * Emscripten module set by wa-sqlite when registering this VFS.
   * Needed for pointer-based methods such as `xFullPathname`.
   */
  protected module?: WasmModuleLike

  readonly mxPathname = 64

  /** Per-fileId metadata for currently open files. */
  readonly #openFiles = new Map<number, OpenFile>()

  public events = new EventEmitter()
  public transferStats: TransferStats

  constructor(name: string, module?: WasmModuleLike) {
    this.name = name
    this.module = module
    this.transferStats = new TransferStats(this.events)
  }

  /** Create a new, empty file. Called once before its first open. */
  protected abstract create(filename: string): MaybePromise<void>

  /** Permanently remove a file from storage. */
  protected abstract delete(filename: string): MaybePromise<void>

  /** Whether a file currently exists in storage. */
  protected abstract exists(filename: string): MaybePromise<boolean>

  /**
   * Read up to `dst.byteLength` bytes starting at `offset` into `dst`,
   * and return the number of bytes actually read. The base class handles
   * zero-filling and `SHORT_READ` reporting when fewer bytes than requested
   * are available.
   */
  protected abstract read(
    filename: string,
    dst: Uint8Array,
    offset: number
  ): MaybePromise<number>

  /**
   * Write all of `src` into the file starting at `offset`. Implementations
   * are expected to grow the file as needed.
   */
  protected abstract write(
    filename: string,
    src: Uint8Array,
    offset: number
  ): MaybePromise<void>

  /** Truncate the file to `size` bytes. */
  protected abstract truncate(
    filename: string,
    size: number
  ): MaybePromise<void>

  /** Return the current size of the file in bytes. */
  protected abstract size(filename: string): MaybePromise<number>

  protected open(_filename: string): MaybePromise<void> {
    // No-op by default, but subclasses can override this to track open files if
    // needed (e.g. for locking or stats).
  }

  // Lifecycle //

  /** Release any resources held by this VFS. Called by users, not SQLite. */
  async close(): Promise<void> {
    for (const fileId of [...this.#openFiles.keys()]) {
      await this.xClose(fileId)
    }
  }

  /**
   * Resolve a sqlite3_file id to its filename. Subclasses may use this if
   * they want to operate on filenames inside overridden `x*` methods.
   *
   * Throws if the file id is unknown — this should never happen in practice
   * because SQLite always opens a file before reading from or writing to it.
   */
  protected filenameOf(fileId: number): string {
    debug(`🗄️ Filesystem::filenameOf`, { fileId })
    const open = this.#openFiles.get(fileId)
    if (!open) {
      throw new Error(`Filesystem: unknown file id ${fileId}`)
    }
    return open.name
  }

  // Low-level SQLite VFS entry points //

  async xOpen(
    nameOrPVfs: string | null | number,
    fileIdOrZName: number,
    flagsOrPFile: number,
    pOutFlagsOrFlags: DataView | number,
    maybePOutFlags?: DataView | number
  ): Promise<SqliteResultCode> {
    const isPointerStyle = typeof nameOrPVfs === "number"
    const fileId = isPointerStyle ? flagsOrPFile : fileIdOrZName
    const flags = isPointerStyle ? (pOutFlagsOrFlags as number) : flagsOrPFile
    const pOutFlags = isPointerStyle
      ? (maybePOutFlags as DataView | number)
      : pOutFlagsOrFlags

    const rawName = isPointerStyle
      ? this.#ptrToNullableFilename(fileIdOrZName)
      : (nameOrPVfs as string | null)
    // SQLite passes a null name for transient/temporary files
    const filename = rawName ?? this.#generateTempName()

    debug(`🗄️ Filesystem::xOpen`, { name: filename, fileId, flags })

    const exists = await this.exists(filename)
    this.events.emit("open", filename, flags, exists)

    if (!exists) {
      if (!(flags & VFS.SQLITE_OPEN_CREATE)) {
        console.warn(
          "🗄️ Filesystem::xOpen failed: file does not exist and CREATE flag not set",
          {
            filename,
            flags,
          }
        )
        return VFS.SQLITE_CANTOPEN
      }
      await this.create(filename)
      this.events.emit("create", filename)
    }

    this.#openFiles.set(fileId, { name: filename, flags })
    this.#setInt32(pOutFlags, flags)
    await this.open(filename)
    return VFS.SQLITE_OK
  }

  async xClose(fileId: number): Promise<SqliteResultCode> {
    const open = this.#openFiles.get(fileId)
    this.#openFiles.delete(fileId)

    if (open && open.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
      await this.delete(open.name)
      this.events.emit("delete", open.name)
    }
    return VFS.SQLITE_OK
  }

  async xRead(
    fileId: number,
    pData: Uint8Array | number,
    iAmtOrOffset: number,
    iOffsetLo?: number,
    iOffsetHi?: number
  ): Promise<SqliteResultCode> {
    const isPointerStyle = typeof pData === "number"
    const length = isPointerStyle ? iAmtOrOffset : pData.byteLength
    const offset = isPointerStyle
      ? this.#fromInt64Parts(iOffsetLo ?? 0, iOffsetHi ?? 0)
      : iAmtOrOffset

    debug(`🗄️ Filesystem::xRead`, { fileId, iOffset: offset, length })
    const filename = this.filenameOf(fileId)

    let bytesRead: number

    if (isPointerStyle) {
      // WASM memory can grow during the async read (Asyncify stack
      // save / SQLite page-cache malloc), which replaces HEAPU8 and
      // invalidates any existing subarray view. Read into a temporary
      // buffer, then copy to a fresh view after the await.
      const tmp = new Uint8Array(length)
      bytesRead = await this.read(filename, tmp, offset)
      const dst = this.#ptrToBytes(pData as number, length)
      dst.set(tmp.subarray(0, bytesRead))
      if (bytesRead < length) dst.fill(0, bytesRead)
    } else {
      bytesRead = await this.read(filename, pData, offset)
      if (bytesRead < length) pData.fill(0, bytesRead)
    }

    this.events.emit("read", filename, bytesRead, offset)
    return bytesRead < length ? VFS.SQLITE_IOERR_SHORT_READ : VFS.SQLITE_OK
  }

  async xWrite(
    fileId: number,
    pData: Uint8Array | number,
    iAmtOrOffset: number,
    iOffsetLo?: number,
    iOffsetHi?: number
  ): Promise<SqliteResultCode> {
    const isPointerStyle = typeof pData === "number"
    // For pointer-style calls, snapshot the data before the async write
    // so a WASM memory growth can't invalidate the view mid-operation.
    const dataView = isPointerStyle
      ? this.#ptrToBytes(pData, iAmtOrOffset).slice()
      : pData
    const offset = isPointerStyle
      ? this.#fromInt64Parts(iOffsetLo ?? 0, iOffsetHi ?? 0)
      : iAmtOrOffset

    debug(`🗄️ Filesystem::xWrite`, {
      fileId,
      iOffset: offset,
      length: dataView.byteLength,
    })
    const filename = this.filenameOf(fileId)
    await this.write(filename, dataView, offset)
    this.events.emit("write", filename, dataView.byteLength)

    return VFS.SQLITE_OK
  }

  async xTruncate(
    fileId: number,
    sizeLo: number,
    sizeHi?: number
  ): Promise<SqliteResultCode> {
    const size =
      sizeHi === undefined ? sizeLo : this.#fromInt64Parts(sizeLo, sizeHi)

    debug(`🗄️ Filesystem::xTruncate`, { fileId, iSize: size })
    const filename = this.filenameOf(fileId)
    await this.truncate(filename, size)
    this.events.emit("truncate", filename, size)
    return VFS.SQLITE_OK
  }

  async xFileSize(
    fileId: number,
    pSize64: number | DataView
  ): Promise<SqliteResultCode> {
    debug(`🗄️ Filesystem::xFileSize`, { fileId })
    const filename = this.filenameOf(fileId)
    const size = await this.size(filename)
    this.events.emit("size", filename, size)

    this.#setBigInt64(pSize64, BigInt(size))
    return VFS.SQLITE_OK
  }

  async xDelete(
    nameOrPVfs: string | number,
    zNameOrSyncDir: number,
    _maybeSyncDir?: number
  ): Promise<SqliteResultCode> {
    const filename =
      typeof nameOrPVfs === "string"
        ? nameOrPVfs
        : (this.#ptrToNullableFilename(zNameOrSyncDir) ?? "")

    debug(`🗄️ Filesystem::xDelete`, { name: filename })
    if (await this.exists(filename)) {
      await this.delete(filename)
      this.events.emit("delete", filename)
    }
    return VFS.SQLITE_OK
  }

  async xAccess(
    nameOrPVfs: string | number,
    zNameOrFlags: number,
    pResOutOrFlags: DataView | number,
    maybePResOut?: DataView | number
  ): Promise<SqliteResultCode> {
    const isPointerStyle = typeof nameOrPVfs === "number"
    const filename =
      typeof nameOrPVfs === "string"
        ? nameOrPVfs
        : (this.#ptrToNullableFilename(zNameOrFlags) ?? "")
    const pResOut = isPointerStyle
      ? (maybePResOut as DataView | number)
      : pResOutOrFlags

    debug(`🗄️ Filesystem::xAccess`, { name: filename })
    this.#setInt32(pResOut, (await this.exists(filename)) ? 1 : 0)
    return VFS.SQLITE_OK
  }

  /**
   * Canonicalise a filename. wa-sqlite calls this during `sqlite3_open_v2`
   * and uses the result as the name for every subsequent call referencing
   * this file.
   *
   * For our purposes the input is already canonical, so we just copy it
   * into the output buffer (null-terminated).
   */
  xFullPathname(
    pVfs: number,
    zName: number,
    nOut: number,
    zOut: number
  ): SqliteResultCode {
    debug(`🗄️ Filesystem::xFullPathname`, { pVfs, zName, nOut, zOut })

    const wasmModule = this.module
    if (!wasmModule) {
      console.error(
        "🗄️ Filesystem::xFullPathname failed: no wasm module available"
      )
      return VFS.SQLITE_IOERR
    }

    const filename = wasmModule.UTF8ToString(zName)
    const zOutArray = wasmModule.HEAPU8.subarray(zOut, zOut + nOut)
    const { read, written } = UTF8_ENCODER.encodeInto(filename, zOutArray)
    if (read < filename.length) {
      console.error(
        "🗄️ Filesystem::xFullPathname failed: read too little",
        read,
        filename
      )

      return VFS.SQLITE_IOERR
    }
    if (written >= zOutArray.length) {
      console.error(
        "🗄️ Filesystem::xFullPathname failed: output buffer too small"
      )

      return VFS.SQLITE_IOERR
    }
    zOutArray[written] = 0

    return VFS.SQLITE_OK
  }

  /** Last-error reporting; we never produce a message. */
  xGetLastError(
    _pVfsOrZBuf: number | Uint8Array,
    _nBuf?: number,
    _zBuf?: number
  ): SqliteResultCode {
    debug(`🗄️ Filesystem::xGetLastError`)

    return VFS.SQLITE_OK
  }

  /**
   * Default no-op implementations of the remaining VFS entry points. SQLite
   * still calls these for every open/read/write cycle, so they must exist
   * even when a backend has nothing meaningful to do. Subclasses may
   * override any of them.
   */

  xSync(_fileId: number, _flags: number): MaybePromise<SqliteResultCode> {
    return VFS.SQLITE_OK
  }

  xLock(_fileId: number, _lockType: number): MaybePromise<SqliteResultCode> {
    return VFS.SQLITE_OK
  }

  xUnlock(_fileId: number, _lockType: number): MaybePromise<SqliteResultCode> {
    return VFS.SQLITE_OK
  }

  xCheckReservedLock(
    _fileId: number,
    pResOut: number | DataView
  ): MaybePromise<SqliteResultCode> {
    this.#setInt32(pResOut, 0)
    return VFS.SQLITE_OK
  }

  xFileControl(
    _fileId: number,
    _op: number,
    _pArg: DataView
  ): MaybePromise<SqliteResultCode> {
    return VFS.SQLITE_NOTFOUND
  }

  xSectorSize(_fileId: number): number {
    return DEFAULT_SECTOR_SIZE
  }

  xDeviceCharacteristics(_fileId: number): number {
    return 0
  }

  hasAsyncMethod(methodName: string): boolean {
    return [
      "xOpen",
      "xClose",
      "xRead",
      "xWrite",
      "xTruncate",
      "xFileSize",
      "xDelete",
      "xAccess",
    ].includes(methodName)
  }

  // Internals //

  #ptrToNullableFilename(value: string | null | number): string | null {
    if (typeof value === "string" || value === null) {
      return value
    }
    const wasmModule = this.module
    if (!wasmModule) {
      return null
    }
    return value ? wasmModule.UTF8ToString(value) : null
  }

  #ptrToBytes(ptr: number, length: number): Uint8Array {
    const wasmModule = this.mustGetModule()
    return wasmModule.HEAPU8.subarray(ptr, ptr + length)
  }

  #setInt32(target: number | DataView, value: number): void {
    if (typeof target === "number") {
      const wasmModule = this.mustGetModule()
      new DataView(wasmModule.HEAPU8.buffer).setInt32(target, value, true)
      return
    }
    target.setInt32(0, value, true)
  }

  #setBigInt64(target: number | DataView, value: bigint): void {
    if (typeof target === "number") {
      const wasmModule = this.mustGetModule()
      new DataView(wasmModule.HEAPU8.buffer).setBigInt64(target, value, true)
      return
    }
    target.setBigInt64(0, value, true)
  }

  #fromInt64Parts(lo: number, hi: number): number {
    return (lo >>> 0) + (hi >>> 0) * UINT32_RANGE
  }

  mustGetModule(): WasmModuleLike {
    const wasmModule = this.module
    if (!wasmModule) {
      throw new Error("Filesystem: wasm module is not available")
    }
    return wasmModule
  }

  #generateTempName(): string {
    return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36)
  }
}
