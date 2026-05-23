#!/usr/bin/env bun

import { FETCH_BLOCK_SIZE } from "@/lib/const"

const HASH_SIZE = 32

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer)
  )
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error("Usage: bun run make-root-hash.ts <file>")
    process.exit(1)
  }

  const file = Bun.file(filePath)
  const data = new Uint8Array(await file.arrayBuffer())
  const blockCount = Math.ceil(data.length / FETCH_BLOCK_SIZE)
  const depth = Math.ceil(Math.log2(blockCount || 1)) + 1

  console.log(`File: ${filePath}`)
  console.log(`Size: ${data.length} bytes`)
  console.log(`Blocks: ${blockCount}, Depth: ${depth}`)

  // Build full tree
  const tree: Uint8Array[][] = []

  // Level 0: leaf hashes
  console.log("Hashing blocks...")
  const leaves: Uint8Array[] = []
  for (let i = 0; i < blockCount; i++) {
    const block = data.slice(i * FETCH_BLOCK_SIZE, (i + 1) * FETCH_BLOCK_SIZE)
    leaves.push(await sha256(block))
  }
  tree.push(leaves)

  // Build upper levels
  let level = leaves
  while (level.length > 1) {
    const next: Uint8Array[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = level[i + 1] ?? left
      const combined = new Uint8Array(64)
      combined.set(left, 0)
      combined.set(right, 32)
      next.push(await sha256(combined))
    }
    tree.push(next)
    level = next
  }

  // Build proof file
  console.log("Building proof file...")
  const proofDepth = tree.length - 1 // Levels of proof (excluding root)
  const headerSize = 8
  const proofSize = proofDepth * HASH_SIZE
  const proofFileSize = headerSize + blockCount * proofSize

  const proofFile = new Uint8Array(proofFileSize)
  const view = new DataView(proofFile.buffer)

  // Header
  view.setUint32(0, blockCount, true)
  view.setUint32(4, proofDepth, true)

  // Extract proof for each block
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
    const proofOffset = headerSize + blockIndex * proofSize
    let idx = blockIndex

    for (let lvl = 0; lvl < proofDepth; lvl++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1
      const sibling = tree[lvl][siblingIdx] ?? tree[lvl][idx]
      proofFile.set(sibling, proofOffset + lvl * HASH_SIZE)
      idx = Math.floor(idx / 2)
    }
  }

  const rootHash = level[0]
  const rootHashHex = rootHash.toHex()
  console.log(`Root: ${rootHashHex} (${rootHash.length} bytes)`)

  // Save root hash
  await Bun.write(
    filePath + ".info.json",
    JSON.stringify({ rootHash: rootHashHex, blockCount, proofDepth }, null, 2)
  )
  console.log(`Saved: ${filePath}.info.json`)

  await Bun.write(filePath + ".proof", proofFile)
  console.log(`Saved: ${filePath}.proof (${proofFileSize} bytes)`)
  console.log(`\nTo fetch proof for block N via HTTP Range:`)
  console.log(`  offset = 8 + N * ${proofSize}`)
  console.log(`  length = ${proofSize}`)
}

main()
