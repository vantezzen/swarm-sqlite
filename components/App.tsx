"use client"
import { DatabaseProvider } from "@/components/database-provider"
import { BookSearch } from "@/components/book-search"
import { StatsPanel } from "@/components/stats-panel"

export default function App() {
  return (
    <DatabaseProvider>
      <main className="h-svh overflow-hidden bg-background">
        <div className="mx-auto flex h-full max-w-[1400px] flex-col">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 p-8 lg:grid-cols-[minmax(0,1fr)_420px]">
            <BookSearch />
            <StatsPanel />
          </div>
        </div>
      </main>
    </DatabaseProvider>
  )
}
