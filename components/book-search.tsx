"use client"

import { useEffect, useState } from "react"
import { Search, Star, ChevronRight, BookOpen, X } from "lucide-react"

import { useDatabase } from "@/components/database-provider"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"

type Book = {
  id: number
  isbn: string | null
  title: string
  author: string | null
  publisher: string | null
  publication_year: number | null
  rating: number | null
  num_ratings: number | null
  image_url_s: string | null
  image_url_m: string | null
  image_url_l: string | null
}

function escapeLike(value: string): string {
  return value.replace(/'/g, "''")
}

export function BookSearch() {
  const { db } = useDatabase()
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [books, setBooks] = useState<Book[]>([])
  const [totalBooks, setTotalBooks] = useState<number | null>(null)
  const [resolvedQuery, setResolvedQuery] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingTime, setLoadingTime] = useState<number | null>(null)
  const loading = resolvedQuery !== debounced

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    const start = performance.now()

    const trimmed = debounced.trim()
    const like = `%${escapeLike(trimmed)}%`
    const whereClause = trimmed
      ? `WHERE b.title LIKE '${like}' OR b.author LIKE '${like}' OR b.publisher LIKE '${like}' OR b.isbn LIKE '${like}'`
      : ""
    // Stage 1: fetch 50 matching books with no join. LIMIT can short-circuit
    // the scan as soon as 50 rows match — SQLite stops reading.
    const sql = `
      SELECT
        b.id,
        b.isbn,
        b.title,
        b.publication_year,
        b.author,
        b.publisher,
        b.image_url_s,
        b.image_url_m,
        b.image_url_l,
        NULL AS rating,
        NULL AS num_ratings
      FROM books b
      ${whereClause}
      LIMIT 50;
      `

    db.exec<Book>(sql)
      .then((rows) => {
        if (cancelled) return
        setBooks(rows)
        setError(null)

        // Stage 2: look up ratings only for the ~50 visible ISBNs. This
        // touches at most a handful of ratings pages instead of scanning
        // the entire ratings table + aggregating every isbn.
        const isbns = rows
          .map((r) => r.isbn)
          .filter((v): v is string => !!v)
          .map((v) => `'${v.replace(/'/g, "''")}'`)
        if (isbns.length === 0) return
        db.exec<{ isbn: string; rating: number; num_ratings: number }>(
          `SELECT isbn, AVG(rating) AS rating, COUNT(*) AS num_ratings
           FROM ratings
           WHERE isbn IN (${isbns.join(",")})
           GROUP BY isbn;`
        )
          .then((ratings) => {
            if (cancelled) return
            const map = new Map(ratings.map((r) => [r.isbn, r]))
            setBooks((prev) =>
              prev.map((b) => {
                const r = b.isbn ? map.get(b.isbn) : undefined
                return r
                  ? { ...b, rating: r.rating, num_ratings: r.num_ratings }
                  : b
              })
            )
          })
          .catch((e: unknown) => {
            console.error("Error loading ratings:", e)
          })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          console.error("Error executing query:", e)
          setError(e instanceof Error ? e.message : String(e))
          setBooks([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setResolvedQuery(debounced)
          setLoadingTime(performance.now() - start)
        }
      })

    db.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM books;`)
      .then(([{ count }]) => {
        if (!cancelled) setTotalBooks(count)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          console.error("Error counting total books:", e)
          setTotalBooks(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [debounced, db])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4.5 w-4.5 -translate-y-1/2 text-ios-label-secondary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles or authors"
          className="h-11 w-full rounded-md border-0 bg-ios-fill pr-10 pl-10 text-[17px] text-foreground placeholder:text-ios-label-secondary focus:ring-0 focus:outline-none"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-3 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-ios-label-tertiary text-white transition hover:opacity-80"
          >
            <X className="h-3 w-3" strokeWidth={3} />
          </button>
        )}
      </div>

      {/* Grouped inset list */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-baseline gap-2">
            <div className="text-[17px] font-semibold text-foreground">
              Top Rated
            </div>
            <div className="text-[13px] text-ios-label-secondary tabular-nums">
              {loading && books.length === 0
                ? ""
                : `${books.length} result${books.length === 1 ? "" : "s"}`}{" "}
              {totalBooks != null && `of ${totalBooks} total`}
              {loadingTime != null && ` · ${loadingTime.toFixed(0)}ms`}
            </div>
          </div>
          {loading && books.length > 0 && (
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-ios-blue">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ios-blue opacity-75"></span>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ios-blue"></span>
              </span>
              Updating
            </div>
          )}
        </div>

        {error && (
          <div className="mx-5 mb-3 rounded-[12px] bg-ios-red/10 px-4 py-3 text-[13px] text-ios-red">
            {error}
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div>
            {loading && books.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <BookSkeleton key={i} />
                ))
              : books.map((book, i) => (
                  <BookRow
                    key={book.id}
                    book={book}
                    isLast={i === books.length - 1}
                  />
                ))}
            {!loading && books.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ios-fill)] text-ios-label-secondary">
                  <BookOpen className="h-6 w-6" />
                </div>
                <div className="text-[15px] font-medium text-foreground">
                  No results
                </div>
                <div className="max-w-[220px] text-[13px] text-ios-label-secondary">
                  Try a different title or author.
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function BookRow({ book, isLast }: { book: Book; isLast: boolean }) {
  return (
    <div className="group relative flex cursor-default items-center gap-3 px-5 py-3 transition-colors active:bg-[var(--ios-fill)]">
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
        <div className="absolute right-0 bottom-0 left-[72px] h-px bg-[var(--ios-separator)]" />
      )}
    </div>
  )
}

function BookSkeleton() {
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
