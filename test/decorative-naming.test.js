import assert from 'node:assert/strict'
import test from 'node:test'

import { auditSvg } from '../src/audit.js'

function codes(source) {
  return auditSvg(source).findings.map((item) => item.code)
}

const MEANINGFUL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <path d="M0 0h10v10z"/>
</svg>`

test('a meaningful SVG must carry a name; a decorative one must not need it', () => {
  assert.ok(codes(MEANINGFUL).includes('ACCESSIBLE_NAME_MISSING'))

  const decorative = codes(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0h10v10z"/></svg>',
  )
  assert.equal(decorative.includes('ACCESSIBLE_NAME_MISSING'), false)
  assert.equal(decorative.includes('DESCRIPTION_MISSING'), false)
})

test('role="none" and role="presentation" are treated as decorative', () => {
  for (const role of ['none', 'presentation', 'NONE']) {
    const found = codes(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="${role}"><path d="M0 0h10v10z"/></svg>`,
    )
    assert.equal(found.includes('ACCESSIBLE_NAME_MISSING'), false, role)
  }
})

test('a decorative SVG that still names itself is contradictory', () => {
  const viaLabel = codes(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true" aria-label="Quarterly revenue"></svg>',
  )
  assert.ok(viaLabel.includes('DECORATIVE_WITH_ACCESSIBLE_NAME'))

  const viaTitle = auditSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="presentation"><title>Quarterly revenue</title></svg>',
  )
  const finding = viaTitle.findings.find((item) => item.code === 'DECORATIVE_WITH_ACCESSIBLE_NAME')
  assert.ok(finding)
  assert.deepEqual(finding.evidence.sources, ['<title>'])
  assert.equal(finding.severity, 'warning')
  assert.equal(finding.basis, 'static')
})

test('the contradiction lists every naming source that applies', () => {
  const result = auditSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true" aria-label="a" aria-labelledby="t">
       <title id="t">b</title>
     </svg>`,
  )
  const finding = result.findings.find((item) => item.code === 'DECORATIVE_WITH_ACCESSIBLE_NAME')

  assert.deepEqual(finding.evidence.sources, ['aria-label', 'aria-labelledby', '<title>'])
})

test('an empty title on a decorative SVG is not a contradiction', () => {
  const found = codes(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true"><title>  </title></svg>',
  )

  assert.equal(found.includes('DECORATIVE_WITH_ACCESSIBLE_NAME'), false)
})

test('a missing reference is located without being fetched', () => {
  const result = auditSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true">
       <use href="#never-defined"/>
     </svg>`,
  )
  const finding = result.findings.find((item) => item.code === 'FRAGMENT_REFERENCE_BROKEN')

  assert.ok(finding)
  assert.equal(finding.basis, 'static')
  assert.equal(typeof finding.location.line, 'number')
  assert.equal(typeof finding.location.column, 'number')
  assert.equal(finding.evidence.reference, '#never-defined')
})
