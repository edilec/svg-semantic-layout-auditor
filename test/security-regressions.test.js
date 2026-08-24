import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { auditSvg } from '../src/audit.js'
import { writeReportSafely } from '../src/output.js'
import { decodeXmlText, parseXml } from '../src/xml.js'

function codes(result) {
  return result.findings.map((finding) => finding.code)
}

test('deep nesting returns a bounded diagnostic instead of overflowing the stack', () => {
  const source = `<svg viewBox="0 0 1 1" aria-hidden="true">${'<g>'.repeat(15_000)}${'</g>'.repeat(15_000)}</svg>`
  const result = auditSvg(source)
  assert.ok(codes(result).includes('XML_DEPTH_LIMIT'))
})

test('large flat newline-heavy documents retain accurate locations without prefix rescans', () => {
  const source = `<svg viewBox="0 0 1 1" aria-hidden="true">\n${'<g/>\n'.repeat(20_000)}</svg>`
  const parsed = parseXml(source, { maxElements: 25_000 })
  assert.equal(parsed.elementCount, 20_001)
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.document.children[0].children.at(-1).location.line, 20_001)
})

test('malformed diagnostics and attributes are capped', () => {
  const malformed = parseXml('<>'.repeat(20_000), { maxDiagnostics: 20 })
  assert.equal(malformed.errors.length, 21)
  assert.equal(malformed.errors.at(-1).code, 'XML_DIAGNOSTIC_LIMIT')

  const attributes = Array.from({ length: 200 }, (_, index) => `a${index}="x"`).join(' ')
  const limited = parseXml(`<svg ${attributes}/>`, { maxAttributes: 16 })
  assert.ok(limited.errors.some((error) => error.code === 'XML_ATTRIBUTE_LIMIT'))
})

test('entity decoding remains linear for unterminated ampersands', () => {
  const source = '&'.repeat(200_000)
  assert.equal(decodeXmlText(source), source)
})

test('layout analysis handles a wide text group within the finding budget', () => {
  const source = `<svg viewBox="0 0 10 10" aria-hidden="true"><g>${'<text x="1" y="1">x</text>'.repeat(10_000)}</g></svg>`
  const result = auditSvg(source, { maxFindings: 50 })
  assert.ok(result.findings.length <= 51)
})

test('safe report output rejects symbolic links and preserves their targets', async (context) => {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'svg-auditor-output-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const target = path.join(directory, 'target.txt')
  const destination = path.join(directory, 'report.json')
  await fs.writeFile(target, 'preserve me')
  await fs.symlink(target, destination)

  await assert.rejects(() => writeReportSafely(destination, '{"safe":true}\n'), /symbolic-link report path/)
  assert.equal(await fs.readFile(target, 'utf8'), 'preserve me')
})

test('atomic report replacement does not modify a hard-linked input inode', async (context) => {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'svg-auditor-hardlink-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source.svg')
  const report = path.join(directory, 'report.json')
  await fs.writeFile(source, '<svg/>')
  await fs.link(source, report)

  await writeReportSafely(report, '{"safe":true}\n')
  assert.equal(await fs.readFile(source, 'utf8'), '<svg/>')
  assert.equal(await fs.readFile(report, 'utf8'), '{"safe":true}\n')
})
