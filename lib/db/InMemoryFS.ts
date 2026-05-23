import { Filesystem } from "./Filesystem"
import debugging from "debug"

const debug = debugging("swarm-sqlite:InMemoryFS")

interface InMemoryFile {
  data: ArrayBuffer
  size: number
}

export class InMemoryFS extends Filesystem {
  readonly #files = new Map<string, InMemoryFile>()

  protected create(filename: string): void {
    debug(`🗄️ InMemoryFS::create`, { filename })
    this.#files.set(filename, {
      data: new ArrayBuffer(0),
      size: 0,
    })
  }

  protected delete(filename: string): void {
    debug(`🗄️ InMemoryFS::delete`, { filename })
    this.#files.delete(filename)
  }

  protected exists(filename: string): boolean {
    debug(`🗄️ InMemoryFS::exists`, { filename })
    return this.#files.has(filename)
  }

  protected read(filename: string, dst: Uint8Array, offset: number): number {
    debug(`🗄️ InMemoryFS::read`, { filename, offset })
    const file = this.#mustGet(filename)

    const start = Math.min(offset, file.size)
    const end = Math.min(offset + dst.byteLength, file.size)
    const bytes = end - start

    if (bytes > 0) {
      dst.set(new Uint8Array(file.data, start, bytes))
    }
    return bytes
  }

  protected write(filename: string, src: Uint8Array, offset: number): void {
    debug(`🗄️ InMemoryFS::write`, { filename, offset })
    const file = this.#mustGet(filename)
    const required = offset + src.byteLength

    if (required > file.data.byteLength) {
      // Amortised growth: at least double the existing capacity, but never
      // less than what the current write requires.
      const newCapacity = Math.max(required, file.data.byteLength * 2)
      const grown = new ArrayBuffer(newCapacity)
      new Uint8Array(grown).set(new Uint8Array(file.data, 0, file.size))
      file.data = grown
    }

    new Uint8Array(file.data, offset, src.byteLength).set(src)
    file.size = Math.max(file.size, required)
  }

  protected truncate(filename: string, size: number): void {
    debug(`🗄️ InMemoryFS::truncate`, { filename, size })
    const file = this.#mustGet(filename)
    // For simplicity we never shrink the underlying ArrayBuffer.
    file.size = Math.min(file.size, size)
  }

  protected size(filename: string): number {
    debug(`🗄️ InMemoryFS::size`, { filename })
    return this.#mustGet(filename).size
  }

  #mustGet(filename: string): InMemoryFile {
    const file = this.#files.get(filename)
    if (!file) {
      throw new Error(`InMemoryFS: file "${filename}" not found`)
    }
    return file
  }
}
