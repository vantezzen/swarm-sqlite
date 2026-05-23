import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function alignToBlockSize(
  offset: number,
  blockSize: number
): [number, number, number] {
  const blockStart = Math.floor(offset / blockSize) * blockSize
  const blockEnd = blockStart + blockSize - 1
  const blockIndex = Math.floor(offset / blockSize)
  return [blockStart, blockEnd, blockIndex]
}
