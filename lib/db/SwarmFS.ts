import { FETCH_BLOCK_SIZE, SQLITE_BLOCK_SIZE } from "../const"
import { MerkleTree } from "../data/MerkleTree"
import Connection from "../p2p/Connection"
import { alignToBlockSize } from "../utils"
import { MaybePromise } from "./Filesystem"
import { HttpFS } from "./HttpFS"
import debugging from "debug"
import "scheduler-polyfill"

const debug = debugging("swarm-sqlite:SwarmFS")

export default class SwarmFS extends HttpFS {
  // filename -> instance
  private connections = new Map<string, Connection>()
  private merkleTrees = new Map<string, MerkleTree>()
  private proofDepths = new Map<string, number>()
  private lastYield = 0

  protected async open(filename: string): Promise<void> {
    debug(`SwarmFS::open`, { filename })

    if (!this.connections.has(filename)) {
      debug(`Creating new Connection for ${filename}`)

      // Download roothash
      const { rootHash, blockCount, proofDepth } =
        await this.getRootFileInfo(filename)
      const merkleTree = new MerkleTree(blockCount, rootHash)
      this.merkleTrees.set(filename, merkleTree)
      this.proofDepths.set(filename, proofDepth)

      // Set up P2P connection
      const connection = new Connection(
        filename,
        this.cache,
        this.events,
        merkleTree
      )
      this.connections.set(filename, connection)
    }
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

    const now = performance.now()
    if (now - this.lastYield > 100) {
      // Keeps the page responsive by yielding to the event loop before doing potentially expensive work.
      await scheduler.yield()
      this.lastYield = now
    }

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

    const connection = this.connections.get(filename)!

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
      }
    }

    const readBytes = await super.read(filename, dst, offset)
    debug(`SwarmFS::read -> got data from HTTP`, {
      filename,
      offset,
      length: dst.byteLength,
    })

    await this.addProofForHttpData(offset, filename)

    return readBytes
  }

  private async addProofForHttpData(offset: number, filename: string) {
    const blockIndex = Math.floor(offset / FETCH_BLOCK_SIZE)
    const proof = await this.getProofFromServer(filename, blockIndex)
    const merkleTree = this.merkleTrees.get(filename)!

    // Hash the full FETCH_BLOCK_SIZE block from cache, not just the small
    // SQLite page in dst — merkle leaves are computed over whole blocks.
    const blockStart = blockIndex * FETCH_BLOCK_SIZE
    const fullBlock = new Uint8Array(FETCH_BLOCK_SIZE)
    const blockBytes = this.cache.read(filename, fullBlock, blockStart) ?? 0
    const blockHash = await merkleTree.hash(fullBlock.subarray(0, blockBytes))
    merkleTree.insert(blockHash, blockIndex, proof)
  }

  protected async readFromPeers(
    filename: string,
    dst: Uint8Array,
    offset: number
  ): Promise<number> {
    const connection = this.connections.get(filename)!
    const [fetchBlockStart, _, blockIndex] = alignToBlockSize(
      offset,
      FETCH_BLOCK_SIZE
    )

    const data = await connection.getData(fetchBlockStart, FETCH_BLOCK_SIZE)
    if (data) {
      this.merkleTrees
        .get(filename)!
        .verifyAndAddData(data.value, blockIndex, data.proof)

      this.cache.put(filename, fetchBlockStart, data.value)
      const offsetWithinBlock = offset - fetchBlockStart
      dst.set(
        data.value.subarray(
          offsetWithinBlock,
          offsetWithinBlock + dst.byteLength
        )
      )

      const newBytes =
        this.cache.missingBlocks(
          filename,
          fetchBlockStart,
          data.value.byteLength
        ).length * SQLITE_BLOCK_SIZE
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

    throw new Error(
      `Failed to read data from peers for ${filename} at offset ${offset}`
    )
  }

  protected async getProofFromServer(filename: string, blockIndex: number) {
    const proofUrl = `${filename}.proof`
    debug(`Fetching proof from ${proofUrl} for block index ${blockIndex}`)

    const proofDepth = this.proofDepths.get(filename)!
    const proofSize = proofDepth * 32 // Each hash is 32 bytes

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
      proofs.push(new Uint8Array(proofData, i, 32))
    }
    debug(`Fetched proof for block index ${blockIndex}`, {
      filename,
      blockIndex,
      proofDepth,
    })
    return proofs
  }
}
