"use client"
import { HttpFS } from "@/lib/db/HttpFS"
import { openDB } from "@/lib/db/openDB"
import { createContext, useContext, useEffect, useState } from "react"

export type Database = {
  exec: <T = Record<string, unknown>>(sql: string) => Promise<T[]>
}

export type DatabaseContextContent = {
  vfs: HttpFS
  db: Database
}

export const DatabaseContext = createContext<DatabaseContextContent | null>(
  null
)

export function useDatabase(): DatabaseContextContent {
  const ctx = useContext(DatabaseContext)
  if (!ctx) throw new Error("useDatabase must be used inside DatabaseProvider")
  return ctx
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [instance, setInstance] = useState<DatabaseContextContent | null>(null)

  useEffect(() => {
    let cancelled = false
    openDB().then(({ vfs, sqlite3, dbHandle }) => {
      if (cancelled) return
      // SQLite on an async VFS is not re-entrant on a single dbHandle:
      // overlapping `exec` calls interleave xRead callbacks and corrupt
      // the page cache (symptoms: "no such table", "malformed image").
      // Serialize all calls through a single promise chain.
      let queue: Promise<unknown> = Promise.resolve()
      const db: Database = {
        exec<T = Record<string, unknown>>(sql: string): Promise<T[]> {
          const run = async (): Promise<T[]> => {
            const rows: T[] = []
            await sqlite3.exec(dbHandle, sql, (row, columns) => {
              const obj: Record<string, unknown> = {}
              for (let i = 0; i < columns.length; i++) {
                obj[columns[i]] = row[i]
              }
              rows.push(obj as T)
            })
            return rows
          }
          const next = queue.then(run, run)
          queue = next.catch(() => undefined)
          return next
        },
      }
      setInstance({ vfs, db })
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!instance) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
          </span>
          Loading database…
        </div>
      </div>
    )
  }

  return (
    <DatabaseContext.Provider value={instance}>
      {children}
    </DatabaseContext.Provider>
  )
}
