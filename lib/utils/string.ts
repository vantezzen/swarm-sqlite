/** Escape single quotes for use inside a SQL LIKE literal. */
export function escapeSqlLike(value: string): string {
  return value.replace(/'/g, "''")
}

/** Extract the filename from a URL or path, stripping query params. */
export function shortFilename(path: string): string {
  const name = path.split("/").pop() || path
  return name.split("?")[0]
}
