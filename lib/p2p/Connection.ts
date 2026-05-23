import { ActionSender, joinRoom, Room } from "trystero"
import { FileContentCache } from "../data/FileContentCache"
import debugging from "debug"
import EventEmitter from "events"
import { MerkleTree } from "../data/MerkleTree"
import { FETCH_BLOCK_SIZE } from "../const"

const debug = debugging("swarm-sqlite:Connection")

type DataResponse = {
  offset: number
  length: number
  value: Uint8Array
  proof: Uint8Array[]
}

type DataRequest = {
  offset: number
  blockIndex: number
  length: number
}

export type DataResult = {
  value: Uint8Array
  time: number
  proof: Uint8Array[]
} | null

export default class Connection {
  public readonly room: Room

  // The VFS accesses are single-threaded so we don't need to handle multiple listeners for the same offset.
  private readonly listeners = new Map<
    number,
    (response: DataResponse) => void
  >()
  private readonly sendData: ActionSender<Uint8Array>
  private readonly sendDataRequest: ActionSender<DataRequest>

  constructor(
    public readonly fileName: string,
    private readonly cache: FileContentCache,
    private readonly events: EventEmitter,
    private readonly merkleTree: MerkleTree
  ) {
    this.room = joinRoom(
      {
        appId: "swarm-sqlite",
        // relayUrls: ["wss://nostr.vantezzen.io"]
      },
      this.fileName
    )

    const [sendData, getData] = this.room.makeAction<Uint8Array>("data")
    this.sendData = sendData
    getData((data, peerId) => this.handleDataResponse(data, peerId))

    const [sendDataRequest, getDataRequest] =
      this.room.makeAction<DataRequest>("data-request")
    this.sendDataRequest = sendDataRequest
    getDataRequest((request, peerId) => this.handleDataRequest(request, peerId))

    this.setupPeerEvents()
  }

  private setupPeerEvents() {
    this.room.onPeerJoin((peerId) => {
      debug(`Peer ${peerId} joined room for ${this.fileName}`)
      this.events.emit("peer-count", this.peerCount())
    })

    this.room.onPeerLeave((peerId) => {
      debug(`Peer ${peerId} left room for ${this.fileName}`)
      this.events.emit("peer-count", this.peerCount())
    })
  }

  waitForPeer(timeout: number = 5000): Promise<void> {
    return new Promise((resolve) => {
      if (this.hasPeers()) {
        resolve()
        return
      }

      let hasResolved = false
      const onPeerJoin = () => {
        if (this.hasPeers()) {
          this.events.off("peer-count", onPeerJoin)
          if (!hasResolved) {
            hasResolved = true
            resolve()
          }
        }
      }

      setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true
          this.events.off("peer-count", onPeerJoin)
          resolve()
        }
      }, timeout)

      this.events.on("peer-count", onPeerJoin)
    })
  }

  private handleDataResponse(data: Uint8Array, peerId: string) {
    const response = this.unpackDataResponse(data)
    debug(
      `Received data from ${peerId} in room for ${this.fileName}:${response.offset}`
    )

    const listener = this.listeners.get(response.offset)
    if (listener) {
      listener(response)
      this.listeners.delete(response.offset)
    }
  }

  private handleDataRequest(request: DataRequest, peerId: string) {
    const dst = new Uint8Array(request.length)
    const bytesRead = this.cache.read(this.fileName, dst, request.offset)
    if (bytesRead === null || bytesRead < request.length) return

    const proof = this.merkleTree.getProofs(request.blockIndex)
    if (!proof) return

    debug(
      `Responding to data request from ${peerId} in room for ${this.fileName}:${request.offset}`,
      { offset: request.offset, length: bytesRead }
    )

    this.events.emit("peer-send", bytesRead)

    try {
      const packed = this.packDataResponse({
        offset: request.offset,
        length: bytesRead,
        value: dst.subarray(0, bytesRead),
        proof,
      })
      this.sendData(packed, peerId)
    } catch (err) {
      debug(
        `Error packing data response for ${peerId} in room for ${this.fileName}:${request.offset}`,
        err
      )
    }
  }

  getData(offset: number, length: number): Promise<DataResult> {
    const startTime = performance.now()

    const dataPromise = new Promise<DataResult>((resolve) => {
      this.listeners.set(offset, (response) => {
        resolve({
          value: response.value,
          time: performance.now() - startTime,
          proof: response.proof,
        })
      })
      this.sendDataRequest({
        offset,
        length,
        blockIndex: Math.floor(offset / FETCH_BLOCK_SIZE),
      })
    })

    return Promise.race([
      dataPromise,
      new Promise<DataResult>((resolve) =>
        setTimeout(() => {
          this.listeners.delete(offset)
          resolve(null)
        }, 1000)
      ),
    ])
  }

  hasPeers(): boolean {
    return this.peerCount() > 0
  }

  destroy() {
    this.room.leave()
    this.listeners.clear()
  }

  private peerCount(): number {
    return Object.keys(this.room.getPeers()).length
  }

  private packDataResponse(response: DataResponse): Uint8Array {
    const proofCount = response.proof.length
    const proofSize = proofCount * 32
    const totalSize = 12 + proofSize + response.value.length

    const buffer = new ArrayBuffer(totalSize)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)

    // Header
    view.setUint32(0, response.offset, true)
    view.setUint32(4, response.value.length, true)
    view.setUint16(8, proofCount, true)
    // bytes 10-11 reserved

    // Proof hashes
    let offset = 12
    for (const hash of response.proof) {
      bytes.set(hash, offset)
      offset += 32
    }

    // Block data
    bytes.set(response.value, offset)

    return new Uint8Array(buffer)
  }

  private unpackDataResponse(bytes: Uint8Array): DataResponse {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    // Header
    const blockIndex = view.getUint32(0, true)
    const blockLength = view.getUint32(4, true)
    const proofCount = view.getUint16(8, true)

    // Proof hashes
    const proof: Uint8Array[] = []
    let offset = 12
    for (let i = 0; i < proofCount; i++) {
      proof.push(bytes.slice(offset, offset + 32))
      offset += 32
    }

    // Block data
    const data = bytes.slice(offset, offset + blockLength)

    return { offset: blockIndex, value: data, length: blockLength, proof }
  }
}
