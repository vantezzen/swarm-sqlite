import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs"
import * as SQLite from "wa-sqlite"
import { HttpFS } from "./HttpFS"
import SwarmFS from "./SwarmFS"

export async function openDB() {
  const sqliteModule = await SQLiteESMFactory()
  const sqlite3 = SQLite.Factory(sqliteModule)

  const vfs = new SwarmFS("swarmfs", sqliteModule)
  sqlite3.vfs_register(vfs as unknown as SQLiteVFS, true)

  const openFlags = SQLite.SQLITE_OPEN_READONLY | SQLite.SQLITE_OPEN_URI
  const dbUri = "file:books.sqlite?mode=ro&immutable=1"
  const dbHandle = await sqlite3.open_v2(dbUri, openFlags, "swarmfs")
  await sqlite3.exec(dbHandle, "PRAGMA query_only = ON;")
  await sqlite3.exec(dbHandle, "PRAGMA journal_mode = OFF;")
  await sqlite3.exec(dbHandle, "PRAGMA page_size = 4096;")
  // Keep all temp storage (sorter spill, temp indexes, materialized
  // subqueries) in RAM so SQLite never tries to xOpen a temp file on
  // the read-only HTTP VFS.
  await sqlite3.exec(dbHandle, "PRAGMA temp_store = MEMORY;")
  // Generous page cache: negative value means KiB, so this is ~64 MiB.
  // Once warm, full table scans are served entirely from SQLite's own
  // page cache and never reach the VFS layer at all.
  await sqlite3.exec(dbHandle, "PRAGMA cache_size = -65536;")

  return { vfs, sqlite3, dbHandle }
}
