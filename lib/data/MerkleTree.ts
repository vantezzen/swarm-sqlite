function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Slice to an owned ArrayBuffer so subarrays hash only their portion
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))
}

export class MerkleTree {
  /** Number of leaf nodes (blocks) */
  readonly blockCount: number

  /** Number of levels in the tree (including leaves) */
  readonly depth: number

  /** Trusted root hash from server */
  readonly rootHash: Uint8Array

  /**
   * Sparse tree storage: tree[level][index] = hash
   * Level 0 = leaves (block hashes)
   * Level (depth-1) = root
   *
   * Using Map for sparse storage - only stores known nodes
   */
  private tree: Map<number, Uint8Array>[]

  constructor(blockCount: number, rootHash: Uint8Array) {
    if (blockCount < 1) {
      throw new Error("Block count must be at least 1")
    }
    if (rootHash.length !== 32) {
      throw new Error(
        `Root hash must be 32 bytes (SHA-256), got ${rootHash.length}`
      )
    }

    this.blockCount = blockCount
    this.rootHash = rootHash
    this.depth = Math.ceil(Math.log2(blockCount)) + 1

    // Initialize sparse tree with empty maps for each level
    this.tree = Array.from({ length: this.depth }, () => new Map())

    // Store the root hash at the top level
    this.tree[this.depth - 1].set(0, rootHash)
  }

  private getSiblingIndex(index: number): number {
    return index % 2 === 0 ? index + 1 : index - 1
  }

  private getParentIndex(index: number): number {
    return Math.floor(index / 2)
  }

  private getLevelSize(level: number): number {
    return Math.ceil(this.blockCount / Math.pow(2, level))
  }

  private isLastAtLevel(level: number, index: number): boolean {
    return index === this.getLevelSize(level) - 1
  }

  /**
   * Verify a block against the trusted root hash
   *
   * @param blockHash - SHA-256 hash of the block data
   * @param blockIndex - Index of the block (0-based)
   * @param proofs - Array of sibling hashes from leaf to root
   * @returns true if verification succeeds
   */
  async verify(
    blockHash: Uint8Array,
    blockIndex: number,
    proofs: Uint8Array[]
  ): Promise<boolean> {
    if (blockIndex < 0 || blockIndex >= this.blockCount) {
      throw new Error(
        `Block index ${blockIndex} out of range [0, ${this.blockCount})`
      )
    }

    const expectedProofLength = this.depth - 1
    if (proofs.length !== expectedProofLength) {
      throw new Error(
        `Expected ${expectedProofLength} proofs, got ${proofs.length}`
      )
    }

    let currentHash = blockHash
    let currentIndex = blockIndex

    for (let level = 0; level < this.depth - 1; level++) {
      const sibling = proofs[level]

      const isLastNode = this.isLastAtLevel(level, currentIndex)
      const siblingIndex = this.getSiblingIndex(currentIndex)
      const siblingExists = siblingIndex < this.getLevelSize(level)

      let combined: Uint8Array
      if (isLastNode && !siblingExists) {
        combined = concatBytes(currentHash, currentHash)
      } else if (currentIndex % 2 === 0) {
        combined = concatBytes(currentHash, sibling)
      } else {
        combined = concatBytes(sibling, currentHash)
      }

      currentHash = await sha256(combined)
      currentIndex = this.getParentIndex(currentIndex)
    }

    return equalBytes(currentHash, this.rootHash)
  }

  /**
   * Insert a block hash and its proofs into the tree.
   * Fills in the sparse tree structure for future proof generation.
   */
  insert(
    blockHash: Uint8Array,
    blockIndex: number,
    proofs: Uint8Array[]
  ): void {
    if (blockIndex < 0 || blockIndex >= this.blockCount) {
      throw new Error(
        `Block index ${blockIndex} out of range [0, ${this.blockCount})`
      )
    }

    if (blockHash.length !== 32) {
      throw new Error("Block hash must be 32 bytes")
    }

    const expectedProofLength = this.depth - 1
    if (proofs.length !== expectedProofLength) {
      throw new Error(
        `Expected ${expectedProofLength} proofs, got ${proofs.length}`
      )
    }

    this.tree[0].set(blockIndex, blockHash)

    let currentIndex = blockIndex
    for (let level = 0; level < this.depth - 1; level++) {
      const siblingIndex = this.getSiblingIndex(currentIndex)
      const siblingExists = siblingIndex < this.getLevelSize(level)

      if (siblingExists) {
        this.tree[level].set(siblingIndex, proofs[level])
      } else {
        // No sibling at this level (odd-length level boundary).
        // Store the proof at currentIndex so getProofs() can retrieve it.
        this.tree[level].set(currentIndex, proofs[level])
      }

      currentIndex = this.getParentIndex(currentIndex)
    }
  }

  /**
   * Get proofs needed to verify a block.
   * Returns null if we don't have all required sibling hashes.
   */
  getProofs(blockIndex: number): Uint8Array[] | null {
    if (blockIndex < 0 || blockIndex >= this.blockCount) {
      throw new Error(
        `Block index ${blockIndex} out of range [0, ${this.blockCount})`
      )
    }

    const proofs: Uint8Array[] = []
    let currentIndex = blockIndex

    for (let level = 0; level < this.depth - 1; level++) {
      const siblingIndex = this.getSiblingIndex(currentIndex)
      const siblingExists = siblingIndex < this.getLevelSize(level)

      if (siblingExists) {
        const sibling = this.tree[level].get(siblingIndex)
        if (!sibling) return null
        proofs.push(sibling)
      } else {
        const self = this.tree[level].get(currentIndex)
        if (!self) return null
        proofs.push(self)
      }

      currentIndex = this.getParentIndex(currentIndex)
    }

    return proofs
  }

  hasBlock(blockIndex: number): boolean {
    return this.tree[0].has(blockIndex)
  }

  getBlockHash(blockIndex: number): Uint8Array | null {
    return this.tree[0].get(blockIndex) ?? null
  }

  getStats(): {
    knownBlocks: number
    totalBlocks: number
    completionPercent: number
    knownNodesPerLevel: number[]
  } {
    const knownBlocks = this.tree[0].size
    const knownNodesPerLevel = this.tree.map((level) => level.size)

    return {
      knownBlocks,
      totalBlocks: this.blockCount,
      completionPercent: (knownBlocks / this.blockCount) * 100,
      knownNodesPerLevel,
    }
  }

  /**
   * Verify block data against the trusted root hash and, if valid,
   * insert the block hash and proofs into the tree.
   */
  async verifyAndAddData(
    blockData: Uint8Array,
    blockIndex: number,
    proofs: Uint8Array[]
  ): Promise<void> {
    const blockHash = await sha256(blockData)
    const isValid = await this.verify(blockHash, blockIndex, proofs)

    if (!isValid) {
      throw new Error(`Data verification failed for block ${blockIndex}`)
    }

    this.insert(blockHash, blockIndex, proofs)
  }

  serialize(): ArrayBuffer {
    let totalNodes = 0
    for (const level of this.tree) {
      totalNodes += level.size
    }

    const headerSize = 42
    const nodeSize = 37
    const bufferSize = headerSize + totalNodes * nodeSize

    const buffer = new ArrayBuffer(bufferSize)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)

    view.setUint32(0, this.blockCount, true)
    view.setUint16(4, this.depth, true)
    bytes.set(this.rootHash, 6)
    view.setUint32(38, totalNodes, true)

    let offset = headerSize
    for (let level = 0; level < this.tree.length; level++) {
      for (const [index, hash] of this.tree[level]) {
        view.setUint8(offset, level)
        view.setUint32(offset + 1, index, true)
        bytes.set(hash, offset + 5)
        offset += nodeSize
      }
    }

    return buffer
  }

  static deserialize(buffer: ArrayBuffer): MerkleTree {
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)

    const blockCount = view.getUint32(0, true)
    const depth = view.getUint16(4, true)
    const rootHash = bytes.slice(6, 38)
    const totalNodes = view.getUint32(38, true)

    const tree = new MerkleTree(blockCount, rootHash)
    if (tree.depth !== depth) {
      throw new Error("Deserialized depth does not match computed depth")
    }

    const headerSize = 42
    const nodeSize = 37
    let offset = headerSize

    for (let i = 0; i < totalNodes; i++) {
      const level = view.getUint8(offset)
      const index = view.getUint32(offset + 1, true)
      const hash = bytes.slice(offset + 5, offset + 37)

      if (level < tree.depth - 1 || index !== 0) {
        tree.tree[level].set(index, hash)
      }

      offset += nodeSize
    }

    return tree
  }
}
