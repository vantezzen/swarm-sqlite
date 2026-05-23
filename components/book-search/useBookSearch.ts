import { useEffect, useState } from "react"
import { escapeSqlLike } from "@/lib/utils/string"
import type { Database } from "@/components/database-provider"

export type Book = {
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

function buildSearchQuery(trimmed: string): string {
  const like = `%${escapeSqlLike(trimmed)}%`
  const where = trimmed
    ? `WHERE b.title LIKE '${like}' OR b.author LIKE '${like}' OR b.publisher LIKE '${like}' OR b.isbn LIKE '${like}'`
    : ""

  return `
    SELECT
      b.id, b.isbn, b.title, b.publication_year,
      b.author, b.publisher,
      b.image_url_s, b.image_url_m, b.image_url_l,
      NULL AS rating, NULL AS num_ratings
    FROM books b
    ${where}
    LIMIT 50;
  `
}

function buildRatingsQuery(isbns: string[]): string {
  const escaped = isbns.map((v) => `'${v.replace(/'/g, "''")}'`)
  return `
    SELECT isbn, AVG(rating) AS rating, COUNT(*) AS num_ratings
    FROM ratings
    WHERE isbn IN (${escaped.join(",")})
    GROUP BY isbn;
  `
}

export function useBookSearch(db: Database) {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [books, setBooks] = useState<Book[]>([])
  const [totalBooks, setTotalBooks] = useState<number | null>(null)
  const [resolvedQuery, setResolvedQuery] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingTime, setLoadingTime] = useState<number | null>(null)

  const loading = resolvedQuery !== debounced

  // Debounce the raw query
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(t)
  }, [query])

  // Run search + count when debounced query changes
  useEffect(() => {
    let cancelled = false
    const start = performance.now()
    const trimmed = debounced.trim()

    db.exec<Book>(buildSearchQuery(trimmed))
      .then((rows) => {
        if (cancelled) return
        setBooks(rows)
        setError(null)

        // Stage 2: look up ratings only for the visible ISBNs
        const isbns = rows
          .map((r) => r.isbn)
          .filter((v): v is string => !!v)
        if (isbns.length === 0) return

        db.exec<{ isbn: string; rating: number; num_ratings: number }>(
          buildRatingsQuery(isbns)
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
          .catch((e: unknown) => console.error("Error loading ratings:", e))
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

    db.exec<{ count: number }>("SELECT COUNT(*) AS count FROM books;")
      .then(([{ count }]) => {
        if (!cancelled) setTotalBooks(count)
      })
      .catch(() => {
        if (!cancelled) setTotalBooks(null)
      })

    return () => {
      cancelled = true
    }
  }, [debounced, db])

  return { query, setQuery, books, totalBooks, error, loadingTime, loading }
}
