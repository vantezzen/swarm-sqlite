import EventEmitter from "events"
import type { FileContentCache } from "../data/FileContentCache"

export default class TransferStats {
  public bytesRead = 0
  public requests = 0

  public peers = 0
  public peerFetches = 0
  public peerFetchFailures = 0
  public peerBytesRead = 0
  public peerBytesSent = 0
  public peerFetchTimes: number[] = []
  public peerFetchBytes: number[] = []

  public httpFetchTimes: number[] = []
  public httpFetchBytes: number[] = []

  public cacheHits = 0
  public cacheStats: { files: number; blocks: number; bytes: number } = {
    files: 0,
    blocks: 0,
    bytes: 0,
  }

  public fileSizes = new Map<string, number>()
  public readFileAreas = new Map<
    string,
    Array<{ offset: number; length: number; type: "http" | "peer" }>
  >()
  public files = new Set<string>()

  private scheduledUpdate: NodeJS.Timeout | null = null
  private cache: FileContentCache | null = null

  constructor(private events: EventEmitter) {
    this.events.on(
      "http-fetch",
      (filename: string, bytes: number, offset: number, duration: number) => {
        this.requests += 1
        this.bytesRead += bytes
        if (duration > 0 && bytes > 0) {
          this.httpFetchTimes.push(duration)
          this.httpFetchBytes.push(bytes)
        }
        if (!this.readFileAreas.has(filename)) {
          this.readFileAreas.set(filename, [])
        }
        this.readFileAreas
          .get(filename)!
          .push({ offset, length: bytes, type: "http" })

        this.onUpdate()
      }
    )

    this.events.on(
      "peer-fetch",
      (
        filename: string,
        bytes: number,
        newBytes: number,
        offset: number,
        time: number
      ) => {
        this.peerFetches += 1
        this.peerBytesRead += bytes
        this.peerFetchTimes.push(time)
        this.peerFetchBytes.push(bytes)

        if (!this.readFileAreas.has(filename)) {
          this.readFileAreas.set(filename, [])
        }
        this.readFileAreas
          .get(filename)!
          .push({ offset, length: newBytes, type: "peer" })

        this.onUpdate()
      }
    )

    this.events.on("peer-fetch-fail", () => {
      this.peerFetchFailures += 1
      this.onUpdate()
    })

    this.events.on("peer-send", (bytes: number) => {
      this.peerBytesSent += bytes
      this.onUpdate()
    })

    this.events.on("peer-count", (count: number) => {
      this.peers = count
      this.onUpdate()
    })

    this.events.on("cache-hit", () => {
      this.cacheHits += 1
      this.onUpdate()
    })

    this.events.on("size", (filename: string, size: number) => {
      this.requests += 1
      this.fileSizes.set(filename, size)
      this.onUpdate()
    })

    this.events.on("create", (filename: string) => {
      this.requests += 1
      this.fileSizes.set(filename, 0)
      this.onUpdate()
    })

    this.events.on("delete", () => {
      this.requests += 1
      this.onUpdate()
    })

    this.events.on("truncate", (filename: string, size: number) => {
      this.requests += 1
      this.fileSizes.set(filename, size)
      this.onUpdate()
    })

    this.events.on("write", (filename: string, bytes: number) => {
      this.requests += 1
      const existing = this.fileSizes.get(filename) ?? 0
      this.fileSizes.set(filename, existing + bytes)
      this.onUpdate()
    })

    this.events.on("open", (filename: string) => {
      this.requests += 1
      this.files.add(filename)
      this.onUpdate()
    })
  }

  /** Set the cache reference so we can poll memory stats on each update. */
  setCache(cache: FileContentCache) {
    this.cache = cache
  }

  private onUpdate() {
    if (this.cache) {
      this.cacheStats = this.cache.stats
    }

    if (this.scheduledUpdate !== null) {
      return
    }

    this.scheduledUpdate = setTimeout(() => {
      this.scheduledUpdate = null
      this.events.emit("update")
    }, 100)
  }
}
