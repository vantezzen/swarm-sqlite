import { useEffect, useReducer } from "react"
import type { HttpFS } from "@/lib/db/HttpFS"

function throughput(times: number[], bytes: number[]): number {
  if (times.length === 0) return 0
  const totalMs = times.reduce((a, b) => a + b, 0)
  const totalBytes = bytes.reduce((a, b) => a + b, 0)
  if (totalMs === 0) return 0
  return (totalBytes / totalMs) * 1000 // bytes per second
}

export function useTransferStats(vfs: HttpFS) {
  const [, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    const onChange = () => bump()
    vfs.events.on("update", onChange)
    return () => {
      vfs.events.off("update", onChange)
    }
  }, [vfs])

  const stats = vfs.transferStats

  const avgP2pDelay =
    stats.peerFetchTimes.length > 0
      ? stats.peerFetchTimes.reduce((a, b) => a + b, 0) /
        stats.peerFetchTimes.length
      : 0

  const cacheHitRate =
    stats.cacheHits + stats.requests > 0
      ? (stats.cacheHits / (stats.cacheHits + stats.requests)) * 100
      : 0

  const httpThroughput = throughput(stats.httpFetchTimes, stats.httpFetchBytes)
  const p2pThroughput = throughput(stats.peerFetchTimes, stats.peerFetchBytes)

  const peerAttempts = stats.peerFetches + stats.peerFetchFailures
  const peerSuccessRate =
    peerAttempts > 0 ? (stats.peerFetches / peerAttempts) * 100 : 0

  return {
    stats,
    avgP2pDelay,
    cacheHitRate,
    httpThroughput,
    p2pThroughput,
    peerSuccessRate,
    peerAttempts,
  }
}
