import { FETCH_BLOCK_SIZE, SQLITE_BLOCK_SIZE } from "../const"
import { MerkleTree } from "../data/MerkleTree"
import Connection from "../p2p/Connection"
import { alignToBlockSize } from "../utils"
import { HttpFS } from "./HttpFS"
import debugging from "debug"
import "scheduler-polyfill"

const debug = debugging("swarm-sqlite:SwarmFS")

interface FileState {
  connection: Connection
  merkleTree: MerkleTree
  proofDepth: number
}

export default class SwarmFS extends HttpFS {
  private readonly openFiles = new Map<string, FileState>()
  private lastYield = 0
  private readonly hashBuffer = new Uint8Array(FETCH_BLOCK_SIZE)

  protected async open(filename: string): Promise<void> {
    debug(`SwarmFS::open`, { filename })
    if (this.openFiles.has(filename)) return

    const { rootHash, blockCount, proofDepth } =
      await this.getRootFileInfo(filename)
    const merkleTree = new MerkleTree(blockCount, rootHash)
    const connection = new Connection(
      filename,
      this.cache,
      this.events,
      merkleTree
    )
    this.openFiles.set(filename, { connection, merkleTree, proofDepth })
    await connection.waitForPeer()
  }

  private getFile(filename: string): FileState {
    const file = this.openFiles.get(filename)
    if (!file) throw new Error(`SwarmFS: file "${filename}" not opened`)
    return file
  }

  private async getRootFileInfo(filename: string): Promise<{
    rootHash: Uint8Array
    blockCount: number
    proofDepth: number
  }> {
    const infoUrl = filename + ".info.json"
    debug(`Fetching root info from ${infoUrl}`)
    const response = await fetch(infoUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch root info: ${response.statusText}`)
    }
    const info = await response.json()
    return {
      rootHash: Uint8Array.fromHex(info.rootHash),
      blockCount: info.blockCount,
      proofDepth: info.proofDepth,
    }
  }

  protected async read(
    filename: string,
    dst: Uint8Array,
    offset: number
  ): Promise<number> {
    debug(`SwarmFS::read`, { filename, offset, length: dst.byteLength })

    await this.yieldIfNeeded()

    if (this.cache.has(filename, offset, dst.byteLength)) {
      debug(`SwarmFS::read -> Cache hit`, {
        filename,
        offset,
        length: dst.byteLength,
      })
      const cached = this.cache.read(filename, dst, offset)!
      this.events.emit("cache-hit", filename, cached, offset)
      return cached
    }

    const { connection } = this.getFile(filename)

    if (connection.hasPeers()) {
      try {
        return await this.readFromPeers(filename, dst, offset)
      } catch (err) {
        debug(`SwarmFS::readFromPeers failed, falling back to HTTP`, {
          filename,
          offset,
          length: dst.byteLength,
          error: err instanceof Error ? err.message : err,
        })
        this.events.emit("peer-fetch-fail", filename, offset)
      }
    }

    const readBytes = await super.read(filename, dst, offset)
    // Proof ingestion is best-effort — the HTTP data in dst is already correct.
    // A failure here (e.g. mismatched proof file) must not crash the read.
    try {
      await this.addProofForHttpData(filename, offset)
    } catch (err) {
      debug(`Failed to ingest proof for block at offset ${offset}`, {
        filename,
        error: err instanceof Error ? err.message : err,
      })
    }
    return readBytes
  }

  private async yieldIfNeeded() {
    const now = performance.now()
    if (now - this.lastYield > 100) {
      await scheduler.yield()
      this.lastYield = now
    }
  }

  private async addProofForHttpData(filename: string, offset: number) {
    const { merkleTree, proofDepth } = this.getFile(filename)
    const blockIndex = Math.floor(offset / FETCH_BLOCK_SIZE)
    const proof = await this.getProofFromServer(
      filename,
      blockIndex,
      proofDepth
    )

    const blockStart = blockIndex * FETCH_BLOCK_SIZE
    // allowPartial: the last block of a file is shorter than FETCH_BLOCK_SIZE,
    // so not all 4 KiB slots in the 1 MiB range will be cached.
    const blockBytes =
      this.cache.read(filename, this.hashBuffer, blockStart, true) ?? 0
    await merkleTree.verifyAndAddData(
      this.hashBuffer.subarray(0, blockBytes),
      blockIndex,
      proof
    )
  }

  protected async readFromPeers(
    filename: string,
    dst: Uint8Array,
    offset: number
  ): Promise<number> {
    const { connection, merkleTree } = this.getFile(filename)
    const [fetchBlockStart, _, blockIndex] = alignToBlockSize(
      offset,
      FETCH_BLOCK_SIZE
    )

    const data = await connection.getData(fetchBlockStart, FETCH_BLOCK_SIZE)
    if (!data) {
      throw new Error(
        `Failed to read data from peers for ${filename} at offset ${offset}`
      )
    }

    await merkleTree.verifyAndAddData(data.value, blockIndex, data.proof)

    // Capture new-byte count before caching (missingBlocks returns 0 after put)
    const newBytes =
      this.cache.missingBlocks(filename, fetchBlockStart, data.value.byteLength)
        .length * SQLITE_BLOCK_SIZE

    this.cache.put(filename, fetchBlockStart, data.value)

    const offsetWithinBlock = offset - fetchBlockStart
    dst.set(
      data.value.subarray(offsetWithinBlock, offsetWithinBlock + dst.byteLength)
    )

    debug(`SwarmFS::read -> got data from peer`, {
      filename,
      offset,
      length: data.value.byteLength,
      newBytes,
    })
    this.events.emit(
      "peer-fetch",
      filename,
      data.value.byteLength,
      newBytes,
      offset,
      data.time
    )
    return dst.byteLength
  }

  private async getProofFromServer(
    filename: string,
    blockIndex: number,
    proofDepth: number
  ) {
    const proofUrl = `${filename}.proof`
    debug(`Fetching proof from ${proofUrl} for block index ${blockIndex}`)

    const proofSize = proofDepth * 32
    const proofStart = 8 + blockIndex * proofSize
    const proofEnd = proofStart + proofSize - 1

    const response = await fetch(proofUrl, {
      headers: {
        Range: `bytes=${proofStart}-${proofEnd}`,
      },
    })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch proof: ${response.status} ${response.statusText}`
      )
    }

    const proofData = await response.arrayBuffer()
    const proofs: Uint8Array[] = []
    for (let i = 0; i < proofData.byteLength; i += 32) {
      proofs.push(new Uint8Array(proofData.slice(i, i + 32)))
    }

    debug(`Fetched proof for block index ${blockIndex}`, {
      filename,
      blockIndex,
      proofDepth,
    })
    return proofs
  }
}
