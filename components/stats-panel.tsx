"use client"

import { useEffect, useReducer } from "react"
import { HardDrive } from "lucide-react"

import { useDatabase } from "@/components/database-provider"
import { ScrollArea } from "@/components/ui/scroll-area"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  )
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function shortName(filename: string): string {
  const trimmed = filename.split("/").pop() || filename
  return trimmed.split("?")[0]
}

export function StatsPanel() {
  const { vfs } = useDatabase()
  const [, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    const onChange = () => bump()
    vfs.events.on("update", onChange)
    return () => {
      vfs.events.off("update", onChange)
    }
  }, [vfs])

  const stats = vfs.transferStats
  const files = Array.from(stats.files)

  const p2pDelay =
    stats.peerFetchTimes.reduce((a, b) => a + b, 0) /
      stats.peerFetchTimes.length || 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="Requests"
          value={Intl.NumberFormat().format(stats.requests)}
          color="text-ios-blue"
        />
        <StatTile
          label="Cache hits"
          value={Intl.NumberFormat().format(stats.cacheHits)}
          color="text-ios-green"
        />
        <StatTile
          label="HTTP Bytes read"
          value={formatBytes(stats.bytesRead)}
          color="text-ios-orange"
        />
        <StatTile
          label="Peer requests"
          value={Intl.NumberFormat().format(stats.peerFetches)}
          color="text-ios-blue"
        />
        <StatTile
          label="Peers"
          value={Intl.NumberFormat().format(stats.peers)}
          color="text-ios-green"
        />
        <StatTile
          label="P2P Bytes read"
          value={formatBytes(stats.peerBytesRead)}
          color="text-ios-orange"
        />
        <StatTile
          label="P2P Bytes sent"
          value={formatBytes(stats.peerBytesSent)}
          color="text-ios-orange"
        />
        <StatTile
          label="P2P Delay"
          value={Intl.NumberFormat().format(p2pDelay) + " ms"}
          color="text-ios-orange"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <HardDrive className="h-[15px] w-[15px] text-ios-label-secondary" />
            <div className="text-[17px] font-semibold text-foreground">
              Files
            </div>
          </div>
          <div className="text-[13px] text-ios-label-secondary tabular-nums">
            {files.length}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div>
            {files.map((file, i) => (
              <FileRow
                key={file}
                filename={file}
                size={stats.fileSizes.get(file) ?? 0}
                reads={stats.readFileAreas.get(file) ?? []}
                isLast={i === files.length - 1}
              />
            ))}
            {files.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ios-fill)] text-ios-label-secondary">
                  <HardDrive className="h-6 w-6" />
                </div>
                <div className="text-[15px] font-medium text-foreground">
                  No files opened
                </div>
                <div className="max-w-[220px] text-[13px] text-ios-label-secondary">
                  File activity will appear here.
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="rounded-[18px] bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
      <div className="text-[11px] font-semibold tracking-wide text-ios-label-secondary uppercase">
        {label}
      </div>
      <div
        className={`mt-1 font-rounded text-[22px] leading-none font-bold tabular-nums ${color}`}
      >
        {value}
      </div>
    </div>
  )
}

function FileRow({
  filename,
  size,
  reads,
  isLast,
}: {
  filename: string
  size: number
  reads: Array<{ offset: number; length: number }>
  isLast: boolean
}) {
  const totalRead = reads.reduce((sum, r) => sum + r.length, 0)
  const coveragePct = size > 0 ? Math.min(100, (totalRead / size) * 100) : 0

  return (
    <div className="relative px-5 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="min-w-0 truncate text-[15px] font-medium text-foreground">
          {shortName(filename)}
        </div>
        <div className="shrink-0 text-[12px] text-ios-label-secondary tabular-nums">
          {formatBytes(totalRead)} / {formatBytes(size)}
          <span className="ml-1.5 text-ios-label-tertiary">
            ({coveragePct.toFixed(1)}%)
          </span>
        </div>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--ios-fill)]">
        {size > 0
          ? reads.map((r, i) => {
              const left = Math.max(0, Math.min(100, (r.offset / size) * 100))
              const width = Math.max(
                0.25,
                Math.min(100 - left, (r.length / size) * 100)
              )
              return (
                <div
                  key={i}
                  className="absolute top-0 h-full bg-ios-blue"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                  }}
                  title={`offset ${r.offset} · ${formatBytes(r.length)}`}
                />
              )
            })
          : null}
      </div>
      <div className="mt-1.5 text-[11px] text-ios-label-tertiary tabular-nums">
        {reads.length} read{reads.length === 1 ? "" : "s"}
      </div>
      {!isLast && (
        <div className="absolute right-0 bottom-0 left-5 h-px bg-[var(--ios-separator)]" />
      )}
    </div>
  )
}
