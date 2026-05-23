import { Skeleton } from "@/components/ui/skeleton"

export function BookSkeleton() {
  return (
    <div className="relative flex items-center gap-3 px-5 py-3">
      <Skeleton className="h-12 w-10 rounded-[6px]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-5 w-10 rounded-full" />
      <div className="absolute right-0 bottom-0 left-[72px] h-px bg-[var(--ios-separator)]" />
    </div>
  )
}
