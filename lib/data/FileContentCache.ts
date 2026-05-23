import { SQLITE_BLOCK_SIZE } from "../const"

/**
 * Block-based read cache for file-backed VFS implementations.
 *
 * SQLite typically reads in small, page-sized chunks (1–4 KiB). To reduce the
 * number of HTTP request we're fetching more data at once and caching it in memory.
 */
export class FileContentCache {
  /** filename -> (block-aligned offset -> block bytes) */
  readonly #blocks = new Map<string, Map<number, Uint8Array>>()

  /**
   * Returns the list of block-aligned offsets that would need to be fetched
   * to fully satisfy a read of `length` bytes at `offset`. Already-cached
   * blocks are omitted. The list is in ascending order.
   */
  missingBlocks(filename: string, offset: number, length: number): number[] {
    if (length <= 0) return []
    const fileBlocks = this.#blocks.get(filename)
    const missing: number[] = []
    const first = this.#blockStart(offset)
    const last = this.#blockStart(offset + length - 1)
    for (let b = first; b <= last; b += SQLITE_BLOCK_SIZE) {
      if (!fileBlocks?.has(b)) missing.push(b)
    }
    return missing
  }

  put(filename: string, offset: number, data: Uint8Array): void {
    if (data.byteLength === 0) return
    let blockOffset = 0
    while (blockOffset < data.byteLength) {
      const blockStart = this.#blockStart(offset + blockOffset)
      const chunkStart = blockOffset
      const chunkEnd = Math.min(
        blockOffset + SQLITE_BLOCK_SIZE,
        data.byteLength
      )
      this.putBlock(filename, blockStart, data.subarray(chunkStart, chunkEnd))
      blockOffset += chunkEnd - chunkStart
    }
  }

  putBlock(filename: string, blockOffset: number, data: Uint8Array): void {
    if (blockOffset < 0 || blockOffset % SQLITE_BLOCK_SIZE !== 0) {
      throw new Error(
        `FileContentCache: blockOffset ${blockOffset} is not a multiple of blockSize ${SQLITE_BLOCK_SIZE}`
      )
    }
    if (data.byteLength > SQLITE_BLOCK_SIZE) {
      throw new Error(
        `FileContentCache: block data (${data.byteLength} bytes) exceeds blockSize ${SQLITE_BLOCK_SIZE}`
      )
    }
    let fileBlocks = this.#blocks.get(filename)
    if (!fileBlocks) {
      fileBlocks = new Map()
      this.#blocks.set(filename, fileBlocks)
    }
    fileBlocks.set(blockOffset, data)
  }

  read(
    filename: string,
    dst: Uint8Array,
    offset: number,
    allowPartial: boolean = false
  ): number | null {
    const length = dst.byteLength
    if (length === 0) return 0

    const fileBlocks = this.#blocks.get(filename)
    if (!fileBlocks) return null

    const first = this.#blockStart(offset)
    const last = this.#blockStart(offset + length - 1)

    if (!allowPartial) {
      // Verify every needed block is present before touching `dst` — we
      // don't want to leave it half-written on a miss.
      for (let b = first; b <= last; b += SQLITE_BLOCK_SIZE) {
        if (!fileBlocks.has(b)) return null
      }
    }

    let written = 0
    for (let b = first; b <= last; b += SQLITE_BLOCK_SIZE) {
      if (!fileBlocks.has(b)) break // missing block, stop reading further

      const block = fileBlocks.get(b)!
      const blockEnd = b + block.byteLength

      const copyStart = Math.max(offset, b)
      const copyEnd = Math.min(offset + length, blockEnd)
      if (copyEnd <= copyStart) {
        // This block is entirely past EOF — nothing more to copy and any
        // following blocks would be past EOF too.
        break
      }

      const srcStart = copyStart - b
      const srcEnd = copyEnd - b
      const dstStart = copyStart - offset
      dst.set(block.subarray(srcStart, srcEnd), dstStart)
      written += srcEnd - srcStart
    }

    return written
  }

  has(filename: string, offset: number, length: number): boolean {
    return this.missingBlocks(filename, offset, length).length === 0
  }

  invalidate(filename: string): void {
    this.#blocks.delete(filename)
  }

  clear(): void {
    this.#blocks.clear()
  }

  get stats(): { files: number; blocks: number; bytes: number } {
    let blocks = 0
    let bytes = 0
    for (const fileBlocks of this.#blocks.values()) {
      blocks += fileBlocks.size
      for (const block of fileBlocks.values()) {
        bytes += block.byteLength
      }
    }
    return { files: this.#blocks.size, blocks, bytes }
  }

  #blockStart(absoluteOffset: number): number {
    return Math.floor(absoluteOffset / SQLITE_BLOCK_SIZE) * SQLITE_BLOCK_SIZE
  }
}
