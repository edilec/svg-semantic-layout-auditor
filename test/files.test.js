import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { auditFile, auditPaths, discoverSvgFiles } from '../src/files.js'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true"></svg>'

test('directory discovery is deterministic and ignores non-SVG files', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'svg-auditor-files-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.mkdir(path.join(directory, 'nested'))
  await fs.writeFile(path.join(directory, 'z.svg'), SVG)
  await fs.writeFile(path.join(directory, 'nested', 'a.SVG'), SVG)
  await fs.writeFile(path.join(directory, 'notes.txt'), 'not an svg')

  const discovered = await discoverSvgFiles([directory])
  assert.deepEqual(discovered.files.map((file) => path.basename(file)), ['a.SVG', 'z.svg'])

  const audited = await auditPaths([directory])
  assert.equal(audited.results.length, 2)
  assert.ok(audited.results.every((result) => result.findings.length === 0))
})

test('symbolic links are skipped instead of followed', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'svg-auditor-links-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const target = path.join(directory, 'target.svg')
  const link = path.join(directory, 'linked.svg')
  await fs.writeFile(target, SVG)
  await fs.symlink(target, link)

  const discovered = await discoverSvgFiles([link])
  assert.deepEqual(discovered.files, [])
  assert.deepEqual(discovered.skippedSymlinks, [link])
})

test('auditFile enforces the size cap before reading', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'svg-auditor-size-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'large.svg')
  await fs.writeFile(file, SVG)
  const result = await auditFile(file, { maxBytes: 8 })
  assert.equal(result.findings[0].code, 'FILE_TOO_LARGE')
})

test('missing input paths have an actionable error', async () => {
  await assert.rejects(() => discoverSvgFiles(['/definitely/missing/diagram.svg']), /does not exist/)
})

test('auditFile refuses symbolic links even when called directly', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'svg-auditor-direct-link-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const target = path.join(directory, 'target.svg')
  const link = path.join(directory, 'linked.svg')
  await fs.writeFile(target, SVG)
  await fs.symlink(target, link)
  await assert.rejects(() => auditFile(link), /symbolic-link|ELOOP/)
})

test('file and traversal budgets apply to direct and non-SVG inputs', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'svg-auditor-budgets-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const first = path.join(directory, 'first.svg')
  const second = path.join(directory, 'second.svg')
  await fs.writeFile(first, SVG)
  await fs.writeFile(second, SVG)
  await fs.writeFile(path.join(directory, 'note.txt'), 'text')

  await assert.rejects(() => discoverSvgFiles([first, second], { maxFiles: 1 }), /SVG file limit/)
  await assert.rejects(() => discoverSvgFiles([directory], { maxEntries: 2 }), /filesystem entry limit/)
})
