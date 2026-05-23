import { Star, ChevronRight } from "lucide-react"
import type { Book } from "./useBookSearch"

export function BookRow({
  book,
  isLast,
  onClick,
}: {
  book: Book
  isLast: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex w-full cursor-default items-center gap-3 px-5 py-3 text-left transition-colors active:bg-[var(--ios-fill)]"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[16px] leading-tight font-semibold text-foreground">
          {book.title}
        </div>
        <div className="mt-0.5 truncate text-[13px] text-ios-label-secondary">
          {book.author ?? "Unknown author"}
          {book.publication_year ? ` · ${book.publication_year}` : ""}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {book.rating != null && (
          <div className="flex items-center gap-1 rounded-full bg-ios-orange/15 px-2 py-0.5 text-[12px] font-semibold text-ios-orange tabular-nums">
            <Star className="h-3 w-3 fill-current" />
            {Number(book.rating).toFixed(1)}
          </div>
        )}
        <ChevronRight className="h-4 w-4 text-ios-label-tertiary" />
      </div>

      {!isLast && (
        <div className="absolute right-0 bottom-0 left-5 h-px bg-[var(--ios-separator)]" />
      )}
    </button>
  )
}
