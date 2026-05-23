import { Database } from "bun:sqlite"
import { parse } from "csv-parse/sync"
import { join } from "node:path"

type BookRow = {
  ISBN: string
  "Book-Title": string
  "Book-Author": string
  "Year-Of-Publication": string
  Publisher: string
  "Image-URL-S": string
  "Image-URL-M": string
  "Image-URL-L": string
}

type RatingRow = {
  "User-ID": string
  ISBN: string
  "Book-Rating": string
}

type UserRow = {
  "User-ID": string
  Location: string
  Age: string | null
}

const [, , datasetDirArg, sqlitePathArg] = Bun.argv

if (!datasetDirArg) {
  console.error("Usage: bun import-books /path/to/dataset [output.sqlite]")
  process.exit(1)
}

const DATASET_DIR = datasetDirArg
const SQLITE_PATH = sqlitePathArg ?? "./public/books.sqlite"

const booksCsvPath = join(DATASET_DIR, "books.csv")
const ratingsCsvPath = join(DATASET_DIR, "ratings.csv")
const usersCsvPath = join(DATASET_DIR, "users.csv")

for (const file of [booksCsvPath, ratingsCsvPath, usersCsvPath]) {
  const exists = await Bun.file(file).exists()
  if (!exists) {
    console.error(`Missing required file: ${file}`)
    process.exit(1)
  }
}

async function parseCsvFile<T>(path: string): Promise<T[]> {
  console.log(`Parsing CSV file: ${path}`)
  const content = await Bun.file(path).text()
  return parse(content, {
    columns: true,
    delimiter: ";",
    escape: "\\",
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as T[]
}

function normalizeString(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  if (s.toUpperCase() === "NULL") return null
  return s
}

function parseInteger(value: unknown): number | null {
  const s = normalizeString(value)
  if (s == null) return null
  const n = Number(s)
  return Number.isInteger(n) ? n : null
}

function cleanYear(value: unknown): number | null {
  const year = parseInteger(value)
  if (year == null) return null

  // Optional sanity filter for obvious bad years in this dataset
  if (year < 0 || year > 2100) return null
  return year
}

const booksRows = await parseCsvFile<BookRow>(booksCsvPath)
const ratingsRows = await parseCsvFile<RatingRow>(ratingsCsvPath)
const usersRows = await parseCsvFile<UserRow>(usersCsvPath)

await Bun.file(SQLITE_PATH).write("") // create or truncate output file

const db = new Database(SQLITE_PATH)

db.run(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA page_size = 4096;

  DROP TABLE IF EXISTS ratings;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS books;
  DROP TABLE IF EXISTS authors;
  DROP TABLE IF EXISTS publishers;
  DROP TABLE IF EXISTS genres;
  DROP TABLE IF EXISTS book_genres;
  DROP TABLE IF EXISTS reviews;

  CREATE TABLE books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    isbn TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    author TEXT,
    publication_year INTEGER,
    publisher TEXT,
    image_url_s TEXT,
    image_url_m TEXT,
    image_url_l TEXT
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    location TEXT,
    age INTEGER
  );

  CREATE TABLE ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    isbn TEXT NOT NULL,
    rating INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (isbn) REFERENCES books(isbn)
  );

  CREATE INDEX idx_books_title ON books(title);
  CREATE INDEX idx_books_author ON books(author);
  CREATE INDEX idx_books_isbn ON books(isbn);

  CREATE INDEX idx_ratings_user_id ON ratings(user_id);

  CREATE INDEX idx_ratings_isbn ON ratings(isbn);
`)

const insertBook = db.prepare(`
  INSERT INTO books (
    isbn, title, author, publication_year, publisher,
    image_url_s, image_url_m, image_url_l
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertUser = db.prepare(`
  INSERT INTO users (
    id, location, age
  ) VALUES (?, ?, ?)
`)

const insertRating = db.prepare(`
  INSERT INTO ratings (
    user_id, isbn, rating
  ) VALUES (?, ?, ?)
`)

const bookExists = db.prepare(`SELECT 1 FROM books WHERE isbn = ? LIMIT 1`)
const userExists = db.prepare(`SELECT 1 FROM users WHERE id = ? LIMIT 1`)

const insertBooksTx = db.transaction((rows: BookRow[]) => {
  let inserted = 0
  const seenIsbns = new Set<string>()
  for (const row of rows) {
    const isbn = normalizeString(row.ISBN)
    const title = normalizeString(row["Book-Title"])

    if (!isbn || !title) continue

    if (seenIsbns.has(isbn)) continue
    seenIsbns.add(isbn)

    insertBook.run(
      isbn,
      title,
      normalizeString(row["Book-Author"]),
      cleanYear(row["Year-Of-Publication"]),
      normalizeString(row.Publisher),
      normalizeString(row["Image-URL-S"]),
      normalizeString(row["Image-URL-M"]),
      normalizeString(row["Image-URL-L"])
    )
    inserted++
  }
  return inserted
})

const insertUsersTx = db.transaction((rows: UserRow[]) => {
  let inserted = 0
  for (const row of rows) {
    const userId = parseInteger(row["User-ID"])
    if (userId == null) continue

    insertUser.run(userId, normalizeString(row.Location), parseInteger(row.Age))
    inserted++
  }
  return inserted
})

const insertRatingsTx = db.transaction((rows: RatingRow[]) => {
  let inserted = 0
  let skipped = 0

  for (const row of rows) {
    const userId = parseInteger(row["User-ID"])
    const isbn = normalizeString(row.ISBN)
    const rating = parseInteger(row["Book-Rating"])

    if (userId == null || !isbn || rating == null) {
      skipped++
      continue
    }

    const hasUser = !!userExists.get(userId)
    const hasBook = !!bookExists.get(isbn)

    if (!hasUser || !hasBook) {
      skipped++
      continue
    }

    insertRating.run(userId, isbn, rating)
    inserted++
  }

  return { inserted, skipped }
})

const booksInserted = insertBooksTx(booksRows)
const usersInserted = insertUsersTx(usersRows)
const ratingsResult = insertRatingsTx(ratingsRows)

const counts = {
  books: Number((db.query(`SELECT COUNT(*) AS c FROM books`).get() as any).c),
  users: Number((db.query(`SELECT COUNT(*) AS c FROM users`).get() as any).c),
  ratings: Number(
    (db.query(`SELECT COUNT(*) AS c FROM ratings`).get() as any).c
  ),
}

console.log(`Created SQLite DB: ${SQLITE_PATH}`)
console.log(`Books inserted: ${booksInserted}`)
console.log(`Users inserted: ${usersInserted}`)
console.log(`Ratings inserted: ${ratingsResult.inserted}`)
console.log(`Ratings skipped: ${ratingsResult.skipped}`)
console.log(`Final counts:`, counts)

db.close()

const fileSize = Bun.file(SQLITE_PATH).size
console.log(`Final database size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`)
const numPages = Math.ceil(fileSize / 4096)
console.log(`Estimated page count: ${numPages.toLocaleString()} pages`)
