"use client"
import { DatabaseProvider } from "@/components/database-provider"
import { BookSearch } from "@/components/book-search"
import { StatsPanel } from "@/components/stats-panel"

export default function App() {
  return (
    <DatabaseProvider>
      <main className="h-svh overflow-hidden bg-background">
        <div className="mx-auto flex h-full max-w-3xl flex-col p-5 sm:p-8 lg:mr-[22rem]">
          <BookSearch />
        </div>
        <StatsPanel />
      </main>
    </DatabaseProvider>
  )
}
