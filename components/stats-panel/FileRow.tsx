import { formatBytes } from "@/lib/utils/format"
import { shortFilename } from "@/lib/utils/string"

export function FileRow({
  filename,
  size,
  reads,
}: {
  filename: string
  size: number
  reads: Array<{ offset: number; length: number }>
}) {
  const totalRead = reads.reduce((sum, r) => sum + r.length, 0)
  const coveragePct = size > 0 ? Math.min(100, (totalRead / size) * 100) : 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
          {shortFilename(filename)}
        </span>
        <span className="shrink-0 text-[11px] text-ios-label-secondary tabular-nums">
          {formatBytes(totalRead)}/{formatBytes(size)}
        </span>
      </div>

      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--ios-fill)]">
        {size > 0 &&
          reads.map((r, i) => {
            const left = Math.max(0, Math.min(100, (r.offset / size) * 100))
            const width = Math.max(
              0.25,
              Math.min(100 - left, (r.length / size) * 100)
            )
            return (
              <div
                key={i}
                className="absolute top-0 h-full rounded-full bg-ios-blue"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            )
          })}
      </div>

      <div className="flex items-baseline justify-between text-[10px] text-ios-label-tertiary tabular-nums">
        <span>{coveragePct.toFixed(0)}% loaded</span>
        <span>{reads.length} reads</span>
      </div>
    </div>
  )
}
