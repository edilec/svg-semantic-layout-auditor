import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

async function ensureDirectoryWithoutLinks(directory) {
  const absolute = path.resolve(directory)
  const root = path.parse(absolute).root
  const relative = path.relative(root, absolute)
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      const stats = await fs.lstat(current)
      if (stats.isSymbolicLink()) throw new Error(`Refusing a symbolic-link report directory: ${current}`)
      if (!stats.isDirectory()) throw new Error(`Report parent is not a directory: ${current}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await fs.mkdir(current, { mode: 0o700 })
      const stats = await fs.lstat(current)
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`Could not create a safe report directory: ${current}`)
    }
  }
  return absolute
}

/** Write a report atomically without following a final-component symbolic link. */
export async function writeReportSafely(destination, content) {
  const absolute = path.resolve(destination)
  const directory = await ensureDirectoryWithoutLinks(path.dirname(absolute))
  const before = await fs.lstat(directory)
  try {
    const destinationStats = await fs.lstat(absolute)
    if (destinationStats.isSymbolicLink()) throw new Error(`Refusing to replace a symbolic-link report path: ${absolute}`)
    if (!destinationStats.isFile()) throw new Error(`Report destination is not a regular file: ${absolute}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const temporary = path.join(directory, `.${path.basename(absolute)}.${crypto.randomUUID()}.tmp`)
  let handle
  try {
    handle = await fs.open(temporary, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null

    const after = await fs.lstat(directory)
    if (after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) {
      throw new Error(`Report directory changed while writing: ${directory}`)
    }
    await fs.rename(temporary, absolute)
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await fs.unlink(temporary).catch(() => {})
    throw error
  }
  return absolute
}
