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

test('a global ARIA name makes the presentational role ineffective', () => {
  for (const role of ['none', 'presentation']) {
    const viaLabel = codes(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="${role}" aria-label="Sales chart"><desc>Sales by month</desc></svg>`,
    )
    assert.equal(viaLabel.includes('DECORATIVE_WITH_ACCESSIBLE_NAME'), false, role)
    assert.equal(viaLabel.includes('ACCESSIBLE_NAME_MISSING'), false, role)

    const viaReference = codes(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="${role}" aria-labelledby="title"><title id="title">Sales chart</title><desc>Sales by month</desc></svg>`,
    )
    assert.equal(viaReference.includes('DECORATIVE_WITH_ACCESSIBLE_NAME'), false, role)
  }
})

test('global description and focusability also defeat a presentational role', () => {
  for (const attribute of ['aria-describedby="desc"', 'tabindex="0"']) {
    const found = codes(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="presentation" ${attribute}><title>Sales chart</title><desc id="desc">Sales by month</desc></svg>`,
    )
    assert.equal(found.includes('DECORATIVE_WITH_ACCESSIBLE_NAME'), false, attribute)
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
