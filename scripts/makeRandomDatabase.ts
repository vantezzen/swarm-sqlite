#!/usr/bin/env bun
/**
 * Generate a well-optimized SQLite books database for P2P chunk-based access testing.
 * ~100K books with proper indexes and 64KB page size.
 *
 * Usage: bun run generate-books-db.ts [output-path]
 * Example: bun run generate-books-db.ts ./books.db
 */

import { Database } from "bun:sqlite"
import { faker } from "@faker-js/faker"

// Configuration
const CONFIG = {
  numBooks: 100_000,
  numAuthors: 15_000,
  numPublishers: 500,
  numReviews: 50_000,
  pageSize: 4 * 1024, // 4KB pages
  seed: 42,
}

// Set seed for reproducibility
faker.seed(CONFIG.seed)

const GENRES = [
  "Fiction",
  "Non-Fiction",
  "Mystery",
  "Thriller",
  "Romance",
  "Science Fiction",
  "Fantasy",
  "Horror",
  "Historical Fiction",
  "Literary Fiction",
  "Young Adult",
  "Children's",
  "Biography",
  "Autobiography",
  "Memoir",
  "Self-Help",
  "Health & Wellness",
  "Cooking",
  "Travel",
  "History",
  "Science",
  "Technology",
  "Philosophy",
  "Psychology",
  "Business",
  "Economics",
  "Politics",
  "Religion",
  "Art",
  "Music",
  "Poetry",
  "Drama",
  "Comics",
  "Graphic Novel",
  "True Crime",
  "Adventure",
  "Western",
  "Dystopian",
  "Paranormal",
  "Contemporary",
  "Classics",
  "Short Stories",
  "Essays",
  "Journalism",
  "Sports",
  "Nature",
  "Gardening",
  "Crafts",
  "Education",
  "Reference",
]

const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Chinese",
  "Japanese",
  "Russian",
  "Portuguese",
]

// Title generation patterns
const titlePatterns = [
  () => `The ${faker.word.noun()} of ${faker.word.noun()}`,
  () => `${faker.word.noun()} and ${faker.word.noun()}`,
  () => `A ${faker.word.adjective()} ${faker.word.noun()}`,
  () => `The Last ${faker.word.noun()}`,
  () => `${faker.person.firstName()}'s ${faker.word.noun()}`,
  () => `Beyond the ${faker.word.noun()}`,
  () => `The ${faker.color.human()} ${faker.word.noun()}`,
  () => `Secrets of ${faker.word.noun()}`,
  () => `The ${faker.word.noun()} Conspiracy`,
  () => `${faker.person.firstName()}'s Journey`,
  () => `Under the ${faker.word.adjective()} Sky`,
  () => `The Art of ${faker.word.verb()}ing`,
  () => `How to ${faker.word.verb()} Your ${faker.word.noun()}`,
  () => `${faker.word.noun()}: A Novel`,
  () => `The Complete Guide to ${faker.word.noun()}`,
]

function generateTitle(): string {
  const pattern =
    titlePatterns[Math.floor(Math.random() * titlePatterns.length)]
  return pattern()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

// Track generated ISBNs to ensure uniqueness
const generatedISBNs = new Set<string>()

function generateISBN(): string {
  let isbn: string

  do {
    const prefix = Math.random() > 0.5 ? "978" : "979"
    const group = Math.floor(Math.random() * 10).toString()
    const publisher = Math.floor(Math.random() * 90000 + 10000)
      .toString()
      .padStart(5, "0")
    const title = Math.floor(Math.random() * 9000 + 1000).toString() // 4 digits for more combinations

    const isbnWithoutCheck = `${prefix}${group}${publisher}${title}`
    let total = 0
    for (let i = 0; i < isbnWithoutCheck.length; i++) {
      total += parseInt(isbnWithoutCheck[i]) * (i % 2 === 0 ? 1 : 3)
    }
    const check = (10 - (total % 10)) % 10

    isbn = `${prefix}-${group}-${publisher}-${title}-${check}`
  } while (generatedISBNs.has(isbn))

  generatedISBNs.add(isbn)
  return isbn
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number, decimals: number = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals))
}

async function createDatabase(dbPath: string): Promise<Database> {
  // Delete existing file if present
  try {
    const file = Bun.file(dbPath)
    if (await file.exists()) {
      await Bun.write(dbPath, "") // Clear it
    }
  } catch {}

  const db = new Database(dbPath)

  // Set page size BEFORE creating tables (must be on empty db)
  db.exec(`PRAGMA page_size = ${CONFIG.pageSize}`)
  db.exec("PRAGMA journal_mode = DELETE")

  console.log("Creating tables...")

  db.exec(`
    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      birth_year INTEGER,
      death_year INTEGER,
      nationality TEXT,
      bio TEXT
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS publishers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      founded_year INTEGER,
      headquarters TEXT,
      website TEXT
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS genres (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      isbn TEXT UNIQUE,
      author_id INTEGER NOT NULL,
      publisher_id INTEGER,
      publication_year INTEGER,
      pages INTEGER,
      language TEXT DEFAULT 'English',
      rating REAL,
      num_ratings INTEGER,
      price REAL,
      description TEXT,
      FOREIGN KEY (author_id) REFERENCES authors(id),
      FOREIGN KEY (publisher_id) REFERENCES publishers(id)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS book_genres (
      book_id INTEGER,
      genre_id INTEGER,
      PRIMARY KEY (book_id, genre_id),
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (genre_id) REFERENCES genres(id)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL,
      reviewer_name TEXT,
      rating INTEGER CHECK(rating >= 1 AND rating <= 5),
      review_text TEXT,
      review_date TEXT,
      FOREIGN KEY (book_id) REFERENCES books(id)
    )
  `)

  return db
}

function populateGenres(db: Database): void {
  console.log("Inserting genres...")
  const stmt = db.prepare(
    "INSERT INTO genres (id, name, description) VALUES (?, ?, ?)"
  )

  const insertMany = db.transaction(() => {
    for (let i = 0; i < GENRES.length; i++) {
      stmt.run(i + 1, GENRES[i], faker.lorem.sentences(2))
    }
  })

  insertMany()
}

function populateAuthors(db: Database): void {
  console.log(`Inserting ${CONFIG.numAuthors.toLocaleString()} authors...`)
  const stmt = db.prepare(
    "INSERT INTO authors (id, name, birth_year, death_year, nationality, bio) VALUES (?, ?, ?, ?, ?, ?)"
  )

  const batchSize = 5000
  const insertBatch = db.transaction((authors: any[]) => {
    for (const author of authors) {
      stmt.run(...author)
    }
  })

  let batch: any[] = []
  for (let i = 0; i < CONFIG.numAuthors; i++) {
    const birthYear = randomInt(1850, 2000)
    const deathYear =
      birthYear > 1950 || Math.random() > 0.3
        ? null
        : birthYear + randomInt(40, 90)

    batch.push([
      i + 1,
      faker.person.fullName(),
      birthYear,
      deathYear,
      faker.location.country(),
      Math.random() > 0.5 ? faker.lorem.sentences(3) : null,
    ])

    if (batch.length >= batchSize) {
      insertBatch(batch)
      batch = []
      process.stdout.write(
        `\r  ${(i + 1).toLocaleString()}/${CONFIG.numAuthors.toLocaleString()} authors...`
      )
    }
  }

  if (batch.length > 0) {
    insertBatch(batch)
  }
  console.log(
    `\r  ${CONFIG.numAuthors.toLocaleString()}/${CONFIG.numAuthors.toLocaleString()} authors... done`
  )
}

function populatePublishers(db: Database): void {
  console.log(
    `Inserting ${CONFIG.numPublishers.toLocaleString()} publishers...`
  )
  const stmt = db.prepare(
    "INSERT INTO publishers (id, name, founded_year, headquarters, website) VALUES (?, ?, ?, ?, ?)"
  )

  const insertMany = db.transaction(() => {
    for (let i = 0; i < CONFIG.numPublishers; i++) {
      stmt.run(
        i + 1,
        faker.company.name() + " Publishing",
        randomInt(1800, 2020),
        `${faker.location.city()}, ${faker.location.country()}`,
        Math.random() > 0.3 ? faker.internet.url() : null
      )
    }
  })

  insertMany()
}

function populateBooks(db: Database): void {
  console.log(`Inserting ${CONFIG.numBooks.toLocaleString()} books...`)

  const bookStmt = db.prepare(`
    INSERT INTO books (id, title, isbn, author_id, publisher_id, publication_year, pages, language, rating, num_ratings, price, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const genreStmt = db.prepare(
    "INSERT INTO book_genres (book_id, genre_id) VALUES (?, ?)"
  )

  const batchSize = 10000

  const insertBatch = db.transaction(
    (books: any[], bookGenres: [number, number][]) => {
      for (const book of books) {
        bookStmt.run(...book)
      }
      for (const [bookId, genreId] of bookGenres) {
        genreStmt.run(bookId, genreId)
      }
    }
  )

  let bookBatch: any[] = []
  let genreBatch: [number, number][] = []

  for (let i = 0; i < CONFIG.numBooks; i++) {
    const bookId = i + 1

    bookBatch.push([
      bookId,
      generateTitle(),
      generateISBN(),
      randomInt(1, CONFIG.numAuthors),
      randomInt(1, CONFIG.numPublishers),
      randomInt(1900, 2024),
      randomInt(50, 1500),
      LANGUAGES[randomInt(0, LANGUAGES.length - 1)],
      randomFloat(1.0, 5.0),
      randomInt(0, 50000),
      randomFloat(0.99, 99.99),
      Math.random() > 0.2 ? faker.lorem.sentences(5) : null,
    ])

    // Assign 1-3 genres per book
    const numGenres = randomInt(1, 3)
    const selectedGenres = new Set<number>()
    while (selectedGenres.size < numGenres) {
      selectedGenres.add(randomInt(1, GENRES.length))
    }
    for (const genreId of selectedGenres) {
      genreBatch.push([bookId, genreId])
    }

    if (bookBatch.length >= batchSize) {
      insertBatch(bookBatch, genreBatch)
      bookBatch = []
      genreBatch = []
      process.stdout.write(
        `\r  ${(i + 1).toLocaleString()}/${CONFIG.numBooks.toLocaleString()} books...`
      )
    }
  }

  if (bookBatch.length > 0) {
    insertBatch(bookBatch, genreBatch)
  }
  console.log(
    `\r  ${CONFIG.numBooks.toLocaleString()}/${CONFIG.numBooks.toLocaleString()} books... done`
  )
}

function populateReviews(db: Database): void {
  console.log(`Inserting ${CONFIG.numReviews.toLocaleString()} reviews...`)
  const stmt = db.prepare(
    "INSERT INTO reviews (id, book_id, reviewer_name, rating, review_text, review_date) VALUES (?, ?, ?, ?, ?, ?)"
  )

  const batchSize = 10000
  const insertBatch = db.transaction((reviews: any[]) => {
    for (const review of reviews) {
      stmt.run(...review)
    }
  })

  let batch: any[] = []
  for (let i = 0; i < CONFIG.numReviews; i++) {
    batch.push([
      i + 1,
      randomInt(1, CONFIG.numBooks),
      faker.person.fullName(),
      randomInt(1, 5),
      Math.random() > 0.3 ? faker.lorem.sentences(randomInt(1, 5)) : null,
      faker.date.past({ years: 10 }).toISOString().split("T")[0],
    ])

    if (batch.length >= batchSize) {
      insertBatch(batch)
      batch = []
      process.stdout.write(
        `\r  ${(i + 1).toLocaleString()}/${CONFIG.numReviews.toLocaleString()} reviews...`
      )
    }
  }

  if (batch.length > 0) {
    insertBatch(batch)
  }
  console.log(
    `\r  ${CONFIG.numReviews.toLocaleString()}/${CONFIG.numReviews.toLocaleString()} reviews... done`
  )
}

function createIndexes(db: Database): void {
  console.log("Creating indexes...")

  const indexes = [
    "CREATE INDEX idx_books_title ON books(title)",
    "CREATE INDEX idx_books_author ON books(author_id)",
    "CREATE INDEX idx_books_publisher ON books(publisher_id)",
    "CREATE INDEX idx_books_year ON books(publication_year)",
    "CREATE INDEX idx_books_rating ON books(rating DESC)",
    "CREATE INDEX idx_books_language ON books(language)",
    "CREATE INDEX idx_books_year_rating ON books(publication_year, rating DESC)",
    "CREATE INDEX idx_authors_name ON authors(name)",
    "CREATE INDEX idx_authors_nationality ON authors(nationality)",
    "CREATE INDEX idx_publishers_name ON publishers(name)",
    "CREATE INDEX idx_book_genres_genre ON book_genres(genre_id)",
    "CREATE INDEX idx_reviews_book ON reviews(book_id)",
    "CREATE INDEX idx_reviews_rating ON reviews(rating)",
    "CREATE INDEX idx_reviews_date ON reviews(review_date)",
  ]

  for (const sql of indexes) {
    db.exec(sql)
  }
}

function optimizeDatabase(db: Database): void {
  console.log("Running ANALYZE...")
  db.exec("ANALYZE")

  console.log("Running VACUUM...")
  db.exec("VACUUM")
}

function printStats(db: Database, dbPath: string): void {
  console.log("\n" + "=".repeat(50))
  console.log("DATABASE STATISTICS")
  console.log("=".repeat(50))

  const tables = [
    "books",
    "authors",
    "publishers",
    "genres",
    "book_genres",
    "reviews",
  ]
  for (const table of tables) {
    const result = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as {
      count: number
    }
    console.log(`  ${table}: ${result.count.toLocaleString()} rows`)
  }

  const pageSize = (db.query("PRAGMA page_size").get() as { page_size: number })
    .page_size
  const pageCount = (
    db.query("PRAGMA page_count").get() as { page_count: number }
  ).page_count

  console.log(`\nPage size: ${(pageSize / 1024).toFixed(0)} KB`)
  console.log(`Page count: ${pageCount.toLocaleString()}`)
  console.log(
    `Estimated size: ${((pageSize * pageCount) / 1024 / 1024).toFixed(2)} MB`
  )

  const indexes = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
    )
    .all() as { name: string }[]

  console.log(`\nIndexes created: ${indexes.length}`)
  for (const idx of indexes) {
    console.log(`  - ${idx.name}`)
  }

  // Get actual file size
  const file = Bun.file(dbPath)
  console.log(`\nActual file size: ${(file.size / 1024 / 1024).toFixed(2)} MB`)
  console.log(`\nDatabase saved to: ${dbPath}`)
  console.log("=".repeat(50))
}

async function main() {
  const dbPath = process.argv[2] || "./public/books.sqlite"

  console.log("=".repeat(50))
  console.log("GENERATING BOOKS DATABASE")
  console.log("=".repeat(50))
  console.log(`Output: ${dbPath}`)
  console.log(`Page size: ${CONFIG.pageSize / 1024} KB`)
  console.log(
    `Target: ${CONFIG.numBooks.toLocaleString()} books, ${CONFIG.numAuthors.toLocaleString()} authors, ${CONFIG.numPublishers.toLocaleString()} publishers`
  )
  console.log()

  const startTime = Date.now()

  const db = await createDatabase(dbPath)

  populateGenres(db)
  populateAuthors(db)
  populatePublishers(db)
  populateBooks(db)
  populateReviews(db)
  createIndexes(db)
  optimizeDatabase(db)
  printStats(db, dbPath)

  db.close()

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\nCompleted in ${elapsed}s`)

  const fileSize = Bun.file(dbPath).size
  console.log(`Final database size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`)
  const numPages = Math.ceil(fileSize / CONFIG.pageSize)
  console.log(`Estimated page count: ${numPages.toLocaleString()} pages`)
}

main().catch(console.error)
