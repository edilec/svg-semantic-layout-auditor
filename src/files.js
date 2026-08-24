import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { auditSvg, DEFAULT_LIMITS } from './audit.js'

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules'])

function limitError(label, limit) {
  return new Error(`Input exceeds the configured ${limit.toLocaleString()} ${label} limit.`)
}

export async function discoverSvgFiles(inputPaths, {
  maxFiles = 10_000,
  maxEntries = 100_000,
  maxDirectories = 10_000,
  maxTraversalDepth = 64,
  maxInputs = 10_000,
} = {}) {
  if (inputPaths.length > maxInputs) throw limitError('input path', maxInputs)
  const discovered = new Set()
  const skippedSymlinks = []
  const queue = inputPaths.map((candidate) => ({ candidate, depth: 0 }))
  let visitedEntries = 0
  let visitedDirectories = 0

  const addFile = (absolute) => {
    if (discovered.has(absolute)) return
    if (discovered.size >= maxFiles) throw limitError('SVG file', maxFiles)
    discovered.add(absolute)
  }

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const { candidate, depth } = queue[queueIndex]
    visitedEntries += 1
    if (visitedEntries > maxEntries) throw limitError('visited filesystem entry', maxEntries)
    const absolute = path.resolve(candidate)
    let stats
    try {
      stats = await fs.lstat(absolute)
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Input path does not exist: ${candidate}`)
      throw error
    }

    if (stats.isSymbolicLink()) {
      skippedSymlinks.push(absolute)
      continue
    }
    if (stats.isFile()) {
      if (path.extname(absolute).toLowerCase() === '.svg') addFile(absolute)
      continue
    }
    if (!stats.isDirectory()) continue
    if (depth >= maxTraversalDepth) throw limitError('directory traversal depth', maxTraversalDepth)
    visitedDirectories += 1
    if (visitedDirectories > maxDirectories) throw limitError('visited directory', maxDirectories)

    const directory = await fs.opendir(absolute)
    for await (const entry of directory) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue
      if (queue.length >= maxEntries) throw limitError('visited filesystem entry', maxEntries)
      queue.push({ candidate: path.join(absolute, entry.name), depth: depth + 1 })
    }
  }

  return {
    files: [...discovered].sort(),
    skippedSymlinks,
    visitedEntries,
    visitedDirectories,
  }
}

async function readRegularFileBounded(absolute, maxBytes) {
  const noFollow = constants.O_NOFOLLOW ?? 0
  let handle
  try {
    handle = await fs.open(absolute, constants.O_RDONLY | noFollow)
  } catch (error) {
    if (error.code === 'ELOOP') throw new Error(`Refusing to follow a symbolic-link input: ${absolute}`)
    throw error
  }

  try {
    const stats = await handle.stat()
    if (!stats.isFile()) throw new Error(`Input is not a regular file: ${absolute}`)
    if (stats.size > maxBytes) return { tooLarge: true, bytes: stats.size }

    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead <= maxBytes) {
      const chunk = await handle.read(buffer, bytesRead, maxBytes + 1 - bytesRead, null)
      if (chunk.bytesRead === 0) break
      bytesRead += chunk.bytesRead
    }
    if (bytesRead > maxBytes) return { tooLarge: true, bytes: bytesRead }
    return { tooLarge: false, bytes: bytesRead, source: buffer.subarray(0, bytesRead).toString('utf8') }
  } finally {
    await handle.close()
  }
}

export async function auditFile(filePath, options = {}) {
  const absolute = path.resolve(filePath)
  const maxBytes = options.maxBytes ?? DEFAULT_LIMITS.maxBytes
  const read = await readRegularFileBounded(absolute, maxBytes)
  if (read.tooLarge) {
    return {
      path: absolute,
      validSvg: false,
      metadata: { bytes: read.bytes, elementCount: 0, viewBox: null, decorative: false },
      findings: [{
        code: 'FILE_TOO_LARGE',
        severity: 'error',
        message: `SVG exceeds the configured ${maxBytes.toLocaleString()} byte limit.`,
      }],
    }
  }
  return { path: absolute, ...auditSvg(read.source, options) }
}

export async function auditPaths(inputPaths, options = {}) {
  const discovery = await discoverSvgFiles(inputPaths, options)
  const results = []
  for (const file of discovery.files) results.push(await auditFile(file, options))
  return { ...discovery, results }
}
