import { Star, BookOpen, Building, Calendar, Hash, Users } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { Book } from "./useBookSearch"

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-ios-label-tertiary" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-ios-label-secondary">{label}</div>
        <div className="text-[14px] text-foreground">{value}</div>
      </div>
    </div>
  )
}

function RatingBadge({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-ios-orange/10 px-4 py-2.5">
      <div className="flex items-center gap-1.5">
        <Star className="h-5 w-5 fill-ios-orange text-ios-orange" />
        <span className="font-rounded text-[22px] font-bold leading-none text-ios-orange tabular-nums">
          {rating.toFixed(1)}
        </span>
      </div>
      <div className="text-[12px] text-ios-label-secondary">
        {Intl.NumberFormat().format(count)} rating{count === 1 ? "" : "s"}
      </div>
    </div>
  )
}

export function BookDetailDialog({
  book,
  onClose,
}: {
  book: Book | null
  onClose: () => void
}) {
  return (
    <Dialog open={book !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm gap-0 overflow-hidden p-0 sm:max-w-md">
        {book && (
          <>
            {/* Header with cover image */}
            <div className="flex gap-4 p-5 pb-3">
              {book.image_url_l || book.image_url_m ? (
                <img
                  src={(book.image_url_l || book.image_url_m)!}
                  alt=""
                  className="h-28 w-20 shrink-0 rounded-lg object-cover shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
                />
              ) : (
                <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-lg bg-[var(--ios-fill)]">
                  <BookOpen className="h-8 w-8 text-ios-label-tertiary" />
                </div>
              )}

              <DialogHeader className="min-w-0 flex-1 gap-1">
                <DialogTitle className="text-[18px] leading-snug font-semibold">
                  {book.title}
                </DialogTitle>
                <DialogDescription className="text-[14px] text-ios-label-secondary">
                  {book.author ?? "Unknown author"}
                </DialogDescription>
                {book.rating != null && book.num_ratings != null && (
                  <div className="pt-1">
                    <RatingBadge
                      rating={book.rating}
                      count={book.num_ratings}
                    />
                  </div>
                )}
              </DialogHeader>
            </div>

            {/* Details list */}
            <div className="border-t border-[var(--ios-separator)] px-5 py-1">
              {book.publisher && (
                <DetailRow
                  icon={Building}
                  label="Publisher"
                  value={book.publisher}
                />
              )}
              {book.publication_year && (
                <DetailRow
                  icon={Calendar}
                  label="Year"
                  value={String(book.publication_year)}
                />
              )}
              {book.isbn && (
                <DetailRow icon={Hash} label="ISBN" value={book.isbn} />
              )}
              {book.num_ratings != null && (
                <DetailRow
                  icon={Users}
                  label="Ratings"
                  value={Intl.NumberFormat().format(book.num_ratings)}
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
