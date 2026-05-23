# swarm-sqlite

> P2P-accelerated SQLite in the browser. Load a hosted database file collaboratively via WebRTC -- peers that already fetched blocks serve them to newcomers, reducing server load - otherwise fall back to HTTP range requests.

## Features

- **wa-sqlite** VFS running entirely in the browser
- **P2P block transfer** via [trystero](https://github.com/nicedoc/trystero) (WebRTC, Nostr signaling)
- **Merkle tree verification** -- every block is verified against a trusted root hash before use
- **HTTP fallback** -- seamlessly falls back to Range requests when no peers are available
- **1 MiB fetch blocks**, cached as 4 KiB SQLite pages

## Technical details

The server hosts three files per database:

| File | Contents |
|---|---|
| `db.sqlite` | The database itself |
| `db.sqlite.info.json` | `{ rootHash, blockCount, proofDepth }` |
| `db.sqlite.proof` | Binary proof file (see below) |

### Proof file layout

The `.proof` file is a flat binary file designed for partial fetching via HTTP `Range` requests -- the client only needs the proof for the block it's verifying, not the entire file.

```
Header (8 bytes):
  [0-3]  blockCount   (uint32 LE)
  [4-7]  proofDepth   (uint32 LE)

Proof for block N at byte offset:
  8 + N * (proofDepth * 32)

Each proof = proofDepth sibling hashes (SHA-256, 32 bytes each), leaf-to-root order.
```

### P2P transfer

Blocks are exchanged over WebRTC data channels. The sender packs the block data together with its merkle proof into a single binary message:

```
[0-3]   byte offset   (uint32 LE)
[4-7]   data length   (uint32 LE)
[8-9]   proof count   (uint16 LE)
[10-11] reserved
[12..]  proof hashes  (count * 32 bytes)
[..]    block data
```

The receiver verifies the proof against the trusted root hash before accepting the block.

### wa-sqlite

We are using [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) as the SQLite WASM harness. As the npm version is severely outdated, this project includes a local copy of the latest wa-sqlite source in `wa-sqlite/`.

## Setup

```bash
bun install
```

### Adding databases

Put your sqlite database into the `public/` directly to host them, then generate the sidecar files with:

```bash
bun run make-root-hash public/your.sqlite
```

Produces `database.sqlite.info.json` and `database.sqlite.proof`. Host all three files on the same origin.

### Run

```bash
bun run dev
```
