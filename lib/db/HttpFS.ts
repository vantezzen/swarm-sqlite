import { Filesystem } from "./Filesystem"
import debugging from "debug"
import { FileContentCache } from "../data/FileContentCache"
import { FETCH_BLOCK_SIZE, SQLITE_BLOCK_SIZE } from "../const"
import { alignToBlockSize } from "../utils"

const debug = debugging("swarm-sqlite:HttpFS")

export class HttpFS extends Filesystem {
  readonly SIDECAR_SUFFIXES = ["-journal", "-wal", "-shm"]
  protected cache = new FileContentCache()

  constructor(...args: ConstructorParameters<typeof Filesystem>) {
    super(...args)
    this.transferStats.setCache(this.cache)
  }

  protected create(_filename: string): void {
    throw new Error("HttpFS is readonly")
  }

  protected delete(_filename: string): void {
    throw new Error("HttpFS is readonly")
  }

  protected async exists(filename: string): Promise<boolean> {
    debug(`exists`, { filename })
    if (this.SIDECAR_SUFFIXES.some((suffix) => filename.endsWith(suffix))) {
      // Prevent trying to read journal/wal etc. as we don't support those
      return false
    }

    const response = await fetch(filename, {
      method: "HEAD",
    })

    const exists = response.status < 400
    debug(`exists`, { filename, exists })
    return exists
  }

  protected async read(
    filename: string,
    dst: Uint8Array,
    offset: number
  ): Promise<number> {
    const start = offset
    const bytesRequested = dst.byteLength
    debug(`read`, {
      filename,
      start,
      bytesRequested,
    })

    if (bytesRequested === 0) return 0

    if (this.cache.has(filename, start, bytesRequested)) {
      debug(`read -> Cache hit`, { filename, start, bytesRequested })
      const cached = this.cache.read(filename, dst, start)!
      this.events.emit("cache-hit", filename, cached, start)
      return cached
    }

    const [fetchStart, fetchEnd] = alignToBlockSize(start, FETCH_BLOCK_SIZE)

    const t0 = performance.now()
    const response = await fetch(filename, {
      headers: {
        Range: `bytes=${fetchStart}-${fetchEnd}`,
      },
    })

    const data = await response.arrayBuffer()
    const src = new Uint8Array(data)
    const duration = performance.now() - t0

    debug("read -> Result", {
      status: response.status,
      fetched: src.byteLength,
      bytesRequested,
    })

    // Count only the blocks that are actually new — blocks already cached
    // (e.g. from a peer fetch) should not inflate the "bytes read" counter.
    const newBytes =
      this.cache.missingBlocks(filename, fetchStart, src.byteLength).length *
      SQLITE_BLOCK_SIZE
    this.cache.put(filename, fetchStart, src)
    this.events.emit("http-fetch", filename, newBytes, fetchStart, duration)
    return this.cache.read(filename, dst, start) ?? 0
  }

  protected write(_filename: string, _src: Uint8Array, _offset: number): void {
    throw new Error("HttpFS is readonly")
  }

  protected truncate(_filename: string, _size: number): void {
    throw new Error("HttpFS is readonly")
  }

  protected async size(filename: string): Promise<number> {
    const response = await fetch(filename, {
      method: "HEAD",
    })
    const filesize = Number(response.headers.get("content-length") ?? 0)

    debug(`size`, { filename, filesize })

    return filesize
  }
}
