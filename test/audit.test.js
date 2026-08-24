import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { auditSvg } from '../src/audit.js'

const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '..')

async function read(relativePath) {
  return fs.readFile(path.join(repository, relativePath), 'utf8')
}

function codes(result) {
  return result.findings.map((finding) => finding.code)
}

test('an accessible, self-contained SVG passes with no findings', async () => {
  const result = auditSvg(await read('examples/accessible-card.svg'))
  assert.equal(result.validSvg, true)
  assert.deepEqual(result.findings, [])
  assert.equal(result.metadata.title, 'Request processing stages')
  assert.deepEqual(result.metadata.viewBox, { x: 0, y: 0, width: 640, height: 360 })
})

test('decorative SVGs do not require title or description', async () => {
  const result = auditSvg(await read('test/fixtures/decorative.svg'))
  assert.equal(result.metadata.decorative, true)
  assert.equal(codes(result).includes('ACCESSIBLE_NAME_MISSING'), false)
  assert.equal(codes(result).includes('DESCRIPTION_MISSING'), false)
})

test('missing accessible metadata is reported', () => {
  const result = auditSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>')
  assert.ok(codes(result).includes('ACCESSIBLE_NAME_MISSING'))
  assert.ok(codes(result).includes('DESCRIPTION_MISSING'))
})

test('aria-labelledby must reference existing IDs', () => {
  const result = auditSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-labelledby="missing"><desc>Shape</desc></svg>')
  assert.ok(codes(result).includes('ARIA_REFERENCE_BROKEN'))
})

test('invalid viewBox and incomplete dimensions are reported', () => {
  const result = auditSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -10 10" width="20" aria-hidden="true"></svg>')
  assert.ok(codes(result).includes('VIEWBOX_INVALID'))
  assert.ok(codes(result).includes('DIMENSIONS_INCOMPLETE'))
})

test('aspect-ratio mismatch is reported when preserveAspectRatio is active', () => {
  const result = auditSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="100" aria-hidden="true"></svg>')
  assert.ok(codes(result).includes('ASPECT_RATIO_MISMATCH'))
})

test('duplicate IDs and broken fragment references are reported', () => {
  const result = auditSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true">
      <path id="shape"/><path id="shape"/><use href="#missing"/>
    </svg>
  `)
  assert.ok(codes(result).includes('ID_DUPLICATE'))
  assert.ok(codes(result).includes('FRAGMENT_REFERENCE_BROKEN'))
})

test('active and remote content receives specific findings', () => {
  const result = auditSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true" onload="run()">
      <script>alert(1)</script>
      <image href="https://example.invalid/image.png"/>
      <foreignObject><div>HTML</div></foreignObject>
    </svg>
  `)
  assert.ok(codes(result).includes('EVENT_HANDLER_ATTRIBUTE'))
  assert.ok(codes(result).includes('SCRIPT_ELEMENT'))
  assert.ok(codes(result).includes('REMOTE_RESOURCE_REFERENCE'))
  assert.ok(codes(result).includes('FOREIGN_OBJECT'))
})

test('scriptable and risky data references are not treated as normal images', () => {
  const result = auditSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true">
      <image href="javascript:alert(1)"/>
      <image href="data:image/svg+xml;base64,PHN2Zy8+"/>
    </svg>
  `)
  assert.ok(codes(result).includes('SCRIPTABLE_REFERENCE'))
  assert.ok(codes(result).includes('RISKY_DATA_REFERENCE'))
})

test('scriptable hyperlinks and remote style resources are reported', () => {
  const result = auditSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true">
      <a href="javascript:alert(1)"><path d="M0 0h2v2z"/></a>
      <path style="fill: url(https://example.invalid/fill.svg#gradient)"/>
    </svg>
  `)
  assert.ok(codes(result).includes('SCRIPTABLE_REFERENCE'))
  assert.ok(codes(result).includes('CSS_REMOTE_RESOURCE'))
})

test('remote reference evidence omits query strings and fragments', () => {
  const result = auditSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true">
      <image href="https://example.invalid/image.png?token=secret#fragment"/>
    </svg>
  `)
  const remote = result.findings.find((item) => item.code === 'REMOTE_RESOURCE_REFERENCE')
  assert.deepEqual(remote.evidence, { origin: 'https://example.invalid', path: '/image.png' })
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('malformed remote references are findings rather than parser crashes', () => {
  const result = auditSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true">
      <image href="https://[invalid"/>
    </svg>
  `)
  const remote = result.findings.find((item) => item.code === 'REMOTE_RESOURCE_REFERENCE')
  assert.deepEqual(remote.evidence, { kind: 'malformed-remote-reference' })
})

test('hidden and definition text is excluded from layout findings', () => {
  const result = auditSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true">
      <defs><text x="1000" y="1000">Definition text outside the viewBox</text></defs>
      <g display="none"><text x="1000" y="1000">Hidden text outside the viewBox</text></g>
    </svg>
  `)
  assert.equal(codes(result).includes('TEXT_MAY_OVERFLOW_VIEWBOX'), false)
})

test('external stylesheet processing instructions are visible in reports', () => {
  const result = auditSvg('<?xml-stylesheet href="https://example.invalid/style.css"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true"></svg>')
  assert.ok(codes(result).includes('EXTERNAL_STYLESHEET_INSTRUCTION'))
})

test('estimated text overflow is reported for the viewBox and nearest card', async () => {
  const result = auditSvg(await read('examples/problematic.svg'))
  assert.ok(codes(result).includes('TEXT_MAY_OVERFLOW_VIEWBOX'))
  assert.ok(codes(result).includes('TEXT_MAY_OVERFLOW_CONTAINER'))
})

test('layout checks can be disabled', async () => {
  const result = auditSvg(await read('examples/problematic.svg'), { layout: false })
  assert.equal(codes(result).includes('TEXT_MAY_OVERFLOW_VIEWBOX'), false)
  assert.equal(codes(result).includes('TEXT_MAY_OVERFLOW_CONTAINER'), false)
})

test('malformed XML is rejected without throwing', async () => {
  const result = auditSvg(await read('test/fixtures/malformed.svg'))
  assert.equal(result.validSvg, false)
  assert.ok(codes(result).some((code) => code.startsWith('XML_')))
})

test('file and element limits bound untrusted input work', () => {
  const tooLarge = auditSvg('<svg/>', { maxBytes: 2 })
  assert.deepEqual(codes(tooLarge), ['FILE_TOO_LARGE'])

  const tooMany = auditSvg('<svg><g/><g/></svg>', { maxElements: 1 })
  assert.ok(codes(tooMany).includes('XML_ELEMENT_LIMIT'))
})

test('URL controls and inherited remote xml:base cannot hide risky references', () => {
  const result = auditSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true" xml:base="https://example.invalid/assets/">
      <image href="asset.png"/>
      <a href="java&#x0A;script:alert(1)"><path d="M0 0h1v1z"/></a>
    </svg>
  `)
  assert.ok(codes(result).includes('REMOTE_RESOURCE_REFERENCE'))
  assert.ok(codes(result).includes('URL_CONTROL_CHARACTER'))
  assert.ok(codes(result).includes('SCRIPTABLE_REFERENCE'))
})

test('viewBox parsing rejects trailing and embedded junk', () => {
  const result = auditSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="prefix 0 0 10 10 suffix" aria-hidden="true"></svg>')
  assert.ok(codes(result).includes('VIEWBOX_INVALID'))
})

test('an extra top-level element makes the SVG root invalid', () => {
  const result = auditSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true"></svg><metadata/>')
  assert.ok(codes(result).includes('SVG_ROOT_INVALID'))
  assert.equal(result.validSvg, false)
})
