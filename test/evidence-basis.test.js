import assert from 'node:assert/strict'
import test from 'node:test'

import { ESTIMATED_FINDING_CODES, auditSvg } from '../src/audit.js'
import { createReport, formatTextReport } from '../src/report.js'

const OVERFLOWING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" aria-hidden="true">
  <text x="2" y="12" font-size="10">A headline far wider than its viewBox</text>
</svg>`

const BROKEN_REFERENCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true">
  <use href="#absent"/>
</svg>`

function byCode(result) {
  return new Map(result.findings.map((item) => [item.code, item]))
}

test('every finding declares the evidence it rests on', () => {
  for (const source of [OVERFLOWING, BROKEN_REFERENCE]) {
    const { findings } = auditSvg(source)
    assert.ok(findings.length > 0)
    for (const item of findings) {
      assert.ok(
        item.basis === 'static' || item.basis === 'estimated',
        `${item.code} declared basis ${String(item.basis)}`,
      )
    }
  }
})

test('document facts are static and layout heuristics are estimated', () => {
  const estimated = byCode(auditSvg(OVERFLOWING))
  const overflow = estimated.get('TEXT_MAY_OVERFLOW_VIEWBOX')
  assert.ok(overflow, 'expected a text overflow finding')
  assert.equal(overflow.basis, 'estimated')

  const statics = byCode(auditSvg(BROKEN_REFERENCE))
  const broken = statics.get('FRAGMENT_REFERENCE_BROKEN')
  assert.ok(broken, 'expected a broken fragment reference')
  assert.equal(broken.basis, 'static')
})

test('the estimated code list matches what the auditor actually tags', () => {
  const { findings } = auditSvg(OVERFLOWING)
  for (const item of findings) {
    assert.equal(
      item.basis === 'estimated',
      ESTIMATED_FINDING_CODES.includes(item.code),
      `${item.code} basis disagrees with ESTIMATED_FINDING_CODES`,
    )
  }
})

test('a bounded-input failure is still tagged', () => {
  const result = auditSvg('<svg/>', { maxBytes: 1 })
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].code, 'FILE_TOO_LARGE')
  assert.equal(result.findings[0].basis, 'static')
})

test('a document with no <svg> root still tags its findings', () => {
  const result = auditSvg('<note>not an svg</note>')
  assert.equal(result.validSvg, false)
  assert.ok(result.findings.length > 0)
  for (const item of result.findings) assert.equal(item.basis, 'static')
})

test('the report summarizes findings by evidence basis', () => {
  const report = createReport(
    [{ path: 'a.svg', ...auditSvg(OVERFLOWING) }],
    { cwd: process.cwd(), includeTimestamp: false },
  )

  assert.equal(
    report.summary.byBasis.static + report.summary.byBasis.estimated,
    report.summary.findingCount,
  )
  assert.ok(report.summary.byBasis.estimated > 0)
})

test('the text report marks estimated findings and explains the marker', () => {
  const report = createReport(
    [{ path: 'a.svg', ...auditSvg(OVERFLOWING) }],
    { cwd: process.cwd(), includeTimestamp: false },
  )
  const text = formatTextReport(report)

  assert.match(text, /TEXT_MAY_OVERFLOW_VIEWBOX.*\[estimated\]/)
  assert.match(text, /come from a text-layout heuristic, not a browser measurement/)
})

test('a report with no estimated findings omits the heuristic note', () => {
  const report = createReport(
    [{ path: 'a.svg', ...auditSvg(BROKEN_REFERENCE) }],
    { cwd: process.cwd(), includeTimestamp: false },
  )
  const text = formatTextReport(report)

  assert.equal(report.summary.byBasis.estimated, 0)
  assert.doesNotMatch(text, /\[estimated\]/)
  assert.doesNotMatch(text, /text-layout heuristic/)
})

test('a report saved before byBasis existed still formats', () => {
  const legacy = {
    files: [{ path: 'a.svg', findings: [] }],
    summary: {
      fileCount: 1,
      findingCount: 0,
      bySeverity: { error: 0, warning: 0, info: 0 },
      skippedSymlinkCount: 0,
    },
  }

  assert.match(formatTextReport(legacy), /1 file\(s\), 0 finding\(s\)/)
})
