"use client"

import { useState } from "react"
import { Search, BookOpen, X } from "lucide-react"
import { useDatabase } from "@/components/database-provider"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useBookSearch, type Book } from "./useBookSearch"
import { BookRow } from "./BookRow"
import { BookSkeleton } from "./BookSkeleton"
import { BookDetailDialog } from "./BookDetailDialog"

export function BookSearch() {
  const { db } = useDatabase()
  const { query, setQuery, books, totalBooks, error, loadingTime, loading } =
    useBookSearch(db)
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Search input */}
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

      {/* Results list */}
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
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ios-blue opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ios-blue" />
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
                    onClick={() => setSelectedBook(book)}
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

      <BookDetailDialog
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
      />
    </div>
  )
}
