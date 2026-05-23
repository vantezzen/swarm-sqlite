import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"

import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "swarm-sqlite",
  description:
    "P2P-enabled SQLite VFS for web applications using WebAssembly and WebRTC",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="antialiased">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
