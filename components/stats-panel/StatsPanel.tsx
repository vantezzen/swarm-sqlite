"use client"

import { useState } from "react"
import {
  Globe,
  Users,
  Zap,
  Clock,
  HardDrive,
  ArrowDown,
  ArrowUp,
  Activity,
  X,
  Database,
  Gauge,
} from "lucide-react"
import { useDatabase } from "@/components/database-provider"
import { formatBytes, formatNumber } from "@/lib/utils/format"
import { useTransferStats } from "./useTransferStats"
import { FileRow } from "./FileRow"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"

function StatRow({
  icon: Icon,
  label,
  value,
  detail,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  detail?: string
  color: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${color}`}
      >
        <Icon className="h-3 w-3 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-ios-label-secondary">{label}</div>
        <div className="text-[13px] leading-tight font-semibold text-foreground tabular-nums">
          {value}
        </div>
        {detail && (
          <div className="text-[11px] leading-tight font-normal text-ios-label-secondary tabular-nums">
            {detail}
          </div>
        )}
      </div>
    </div>
  )
}

function formatThroughput(bytesPerSec: number): string {
  if (bytesPerSec === 0) return "--"
  return `${formatBytes(bytesPerSec)}/s`
}

function PanelContent() {
  const { vfs } = useDatabase()
  const {
    stats,
    avgP2pDelay,
    cacheHitRate,
    httpThroughput,
    p2pThroughput,
    peerSuccessRate,
    peerAttempts,
  } = useTransferStats(vfs)
  const files = Array.from(stats.files)

  return (
    <div className="flex flex-col">
      {/* Transfer stats */}
      <div className="grid grid-cols-2 gap-3 p-4">
        <StatRow
          icon={Globe}
          label="HTTP"
          value={formatBytes(stats.bytesRead)}
          detail={`${formatNumber(stats.requests)} req · ${formatThroughput(httpThroughput)}`}
          color="bg-ios-blue"
        />
        <StatRow
          icon={Users}
          label="P2P"
          value={formatBytes(stats.peerBytesRead)}
          detail={`${formatNumber(stats.peers)} peer${stats.peers === 1 ? "" : "s"} · ${formatThroughput(p2pThroughput)}`}
          color="bg-ios-green"
        />
        <StatRow
          icon={Zap}
          label="Cache"
          value={`${cacheHitRate.toFixed(0)}%`}
          detail={`${formatNumber(stats.cacheHits)} hits`}
          color="bg-ios-orange"
        />
        <StatRow
          icon={Clock}
          label="P2P latency"
          value={avgP2pDelay > 0 ? `${avgP2pDelay.toFixed(0)}ms` : "--"}
          detail={
            peerAttempts > 0
              ? `${peerSuccessRate.toFixed(0)}% success`
              : undefined
          }
          color="bg-ios-purple"
        />
      </div>

      {/* P2P bandwidth */}
      {(stats.peerBytesRead > 0 || stats.peerBytesSent > 0) && (
        <div className="mx-4 flex items-center gap-4 rounded-xl bg-[var(--ios-fill)] px-3 py-2 text-[12px] tabular-nums">
          <span className="flex items-center gap-1 text-ios-green">
            <ArrowDown className="h-3 w-3" />
            {formatBytes(stats.peerBytesRead)}
          </span>
          <span className="flex items-center gap-1 text-ios-blue">
            <ArrowUp className="h-3 w-3" />
            {formatBytes(stats.peerBytesSent)}
          </span>
          <span className="text-ios-label-secondary">
            {formatNumber(stats.peerFetches)} transfers
          </span>
        </div>
      )}

      {/* Cache memory */}
      {stats.cacheStats.bytes > 0 && (
        <div className="mx-4 mt-2 flex items-center gap-2.5 rounded-xl bg-[var(--ios-fill)] px-3 py-2 text-[12px] tabular-nums">
          <Database className="h-3 w-3 text-ios-label-secondary" />
          <span className="text-foreground font-medium">
            {formatBytes(stats.cacheStats.bytes)}
          </span>
          <span className="text-ios-label-secondary">
            in {formatNumber(stats.cacheStats.blocks)} blocks
          </span>
        </div>
      )}

      {/* Files section */}
      <div className="mt-3 border-t border-[var(--ios-separator)]">
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <HardDrive className="h-3.5 w-3.5 text-ios-label-secondary" />
          <span className="text-[12px] font-semibold tracking-wide text-ios-label-secondary uppercase">
            Files
          </span>
          <span className="text-[11px] text-ios-label-tertiary tabular-nums">
            {files.length}
          </span>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 px-4 pt-1 pb-4">
            {files.map((file) => (
              <FileRow
                key={file}
                filename={file}
                size={stats.fileSizes.get(file) ?? 0}
                reads={stats.readFileAreas.get(file) ?? []}
              />
            ))}
            {files.length === 0 && (
              <div className="py-6 text-center text-[12px] text-ios-label-tertiary">
                No files opened yet
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

/** Compact pill shown on mobile to open the stats sheet. */
function MobilePill() {
  const { vfs } = useDatabase()
  const { stats, httpThroughput, p2pThroughput } = useTransferStats(vfs)
  const speed = Math.max(httpThroughput, p2pThroughput)

  return (
    <div className="flex items-center gap-2 text-[12px] font-medium tabular-nums">
      <Activity className="h-3.5 w-3.5 text-ios-blue" />
      <span>
        {formatNumber(stats.peers)} peer{stats.peers === 1 ? "" : "s"}
      </span>
      <span className="text-ios-label-tertiary">·</span>
      <span>{formatBytes(stats.bytesRead + stats.peerBytesRead)}</span>
      {speed > 0 && (
        <>
          <span className="text-ios-label-tertiary">·</span>
          <span className="flex items-center gap-0.5">
            <Gauge className="h-3 w-3" />
            {formatThroughput(speed)}
          </span>
        </>
      )}
    </div>
  )
}

export function StatsPanel() {
  const [desktopOpen, setDesktopOpen] = useState(true)

  return (
    <>
      {/* Desktop: floating glass panel */}
      <div className="pointer-events-none fixed inset-y-0 right-0 z-40 hidden w-[22rem] p-5 lg:block">
        {desktopOpen ? (
          <div className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-[var(--ios-separator)] bg-card/80 shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--ios-separator)] px-4 py-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-ios-blue" />
                <span className="text-[14px] font-semibold text-foreground">
                  Transfer Monitor
                </span>
              </div>
              <button
                onClick={() => setDesktopOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[var(--ios-fill)]"
              >
                <X className="h-3.5 w-3.5 text-ios-label-secondary" />
              </button>
            </div>

            <PanelContent />
          </div>
        ) : (
          <div className="pointer-events-auto flex justify-end pt-2">
            <button
              onClick={() => setDesktopOpen(true)}
              className="flex h-9 items-center gap-2 rounded-full border border-[var(--ios-separator)] bg-card/80 px-4 shadow-[0_4px_16px_rgba(0,0,0,0.06)] backdrop-blur-xl transition hover:bg-card"
            >
              <Activity className="h-3.5 w-3.5 text-ios-blue" />
              <span className="text-[12px] font-medium text-foreground">
                Monitor
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Mobile: bottom sheet */}
      <div className="fixed right-4 bottom-4 z-40 lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <button className="flex h-10 items-center gap-2 rounded-full border border-[var(--ios-separator)] bg-card/90 px-4 shadow-[0_4px_20px_rgba(0,0,0,0.1)] backdrop-blur-xl transition active:scale-95">
              <MobilePill />
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl px-0 pb-8">
            <SheetTitle className="flex items-center gap-2 px-4 pb-2">
              <Activity className="h-4 w-4 text-ios-blue" />
              <span className="text-[16px] font-semibold">
                Transfer Monitor
              </span>
            </SheetTitle>
            <PanelContent />
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
