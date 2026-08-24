import { attribute, directChild, elementText, elements, parseXml } from './xml.js'
import { auditTextLayout, dimensionFindings, parseViewBox } from './geometry.js'

export const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxElements: 50_000,
  maxDepth: 256,
  maxAttributes: 1_024,
  maxDiagnostics: 200,
  maxFindings: 1_000,
})

function finding(code, severity, message, node = null, evidence = undefined) {
  return {
    code,
    severity,
    message,
    ...(node?.location ? { location: node.location } : {}),
    ...(evidence ? { evidence } : {}),
  }
}

function isDecorative(svg) {
  const role = String(attribute(svg, 'role') ?? '').toLowerCase()
  return String(attribute(svg, 'aria-hidden') ?? '').toLowerCase() === 'true' || role === 'none' || role === 'presentation'
}

function referenceKind(value) {
  const normalized = String(value ?? '').trim().replace(/[\t\n\r]/g, '')
  if (!normalized) return 'empty'
  if (normalized.startsWith('#')) return 'fragment'
  if (/^javascript:/i.test(normalized)) return 'scriptable'
  if (/^(?:https?:)?\/\//i.test(normalized)) return 'remote'
  if (/^(?:file|ftp):/i.test(normalized) || normalized.startsWith('/')) return 'local-absolute'
  if (/^data:/i.test(normalized)) return 'data'
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return 'other-scheme'
  return 'relative'
}

function remoteReferenceEvidence(value) {
  try {
    const parsed = value.startsWith('//') ? new URL(`https:${value}`) : new URL(value)
    return { origin: parsed.origin, path: parsed.pathname.slice(0, 256) }
  } catch {
    return { kind: 'malformed-remote-reference' }
  }
}

function auditAccessibility(svg, allElements, idMap, textFor) {
  const findings = []
  const title = directChild(svg, 'title')
  const description = directChild(svg, 'desc')
  const decorative = isDecorative(svg)
  const ariaLabel = attribute(svg, 'aria-label')?.trim()
  const labelledBy = attribute(svg, 'aria-labelledby')?.trim().split(/\s+/).filter(Boolean) ?? []

  if (decorative) return findings

  if (!title && !ariaLabel && labelledBy.length === 0) {
    findings.push(finding('ACCESSIBLE_NAME_MISSING', 'warning', 'Non-decorative SVG has no <title>, aria-label, or aria-labelledby.', svg))
  }
  if (title && !textFor(title)) {
    findings.push(finding('TITLE_EMPTY', 'warning', '<title> is present but empty.', title))
  }
  if (!description) {
    findings.push(finding('DESCRIPTION_MISSING', 'warning', 'Non-decorative SVG has no direct <desc> element.', svg))
  } else if (!textFor(description)) {
    findings.push(finding('DESCRIPTION_EMPTY', 'warning', '<desc> is present but empty.', description))
  }
  for (const id of labelledBy) {
    if (!idMap.has(id)) {
      findings.push(finding('ARIA_REFERENCE_BROKEN', 'error', `aria-labelledby references missing id “${id}”.`, svg, { id }))
    }
  }
  if (attribute(svg, 'role') === 'img' && labelledBy.length === 0 && !ariaLabel && title && textFor(title) && !attribute(title, 'id')) {
    findings.push(finding(
      'TITLE_NOT_EXPLICITLY_LABELLED',
      'info',
      'For consistent assistive-technology support, give <title> an id and reference it with aria-labelledby.',
      title,
    ))
  }
  return findings
}

function effectiveBase(node, cache) {
  if (cache.has(node)) return cache.get(node)
  const chain = []
  let current = node
  while (current?.type === 'element' && !cache.has(current)) {
    chain.push(current)
    current = current.parent
  }
  let base = current?.type === 'element' ? cache.get(current) : null
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const declared = attribute(chain[index], 'xml:base')
    if (declared) {
      const normalized = declared.trim().replace(/[\t\n\r]/g, '')
      try {
        base = new URL(normalized, base ?? 'file:///__svg_document__/').href
      } catch {
        base = null
      }
    }
    cache.set(chain[index], base)
  }
  return base
}

function resolvedReference(node, value, baseCache) {
  const raw = String(value ?? '')
  const normalized = raw.trim().replace(/[\t\n\r]/g, '')
  const controls = /[\u0000-\u001f\u007f]/.test(raw)
  let kind = referenceKind(normalized)
  let resolved = normalized
  const base = effectiveBase(node, baseCache)
  if (base && (kind === 'relative' || kind === 'fragment')) {
    try {
      resolved = new URL(normalized, base).href
      kind = referenceKind(resolved)
    } catch {
      // Keep the raw classification and report only static evidence.
    }
  }
  return { raw, normalized, controls, kind, resolved, base }
}

function auditActiveContent(allElements, idMap, { maxFindings = 1_000 } = {}) {
  const findings = []
  const resourceElements = new Set(['image', 'use', 'feimage'])
  const baseCache = new WeakMap()
  const add = (item) => {
    if (findings.length < maxFindings) findings.push(item)
  }

  for (const node of allElements) {
    if (findings.length >= maxFindings) break
    if (node.localName === 'script') {
      add(finding('SCRIPT_ELEMENT', 'error', '<script> introduces executable content into the SVG.', node))
    }
    if (node.localName === 'foreignobject') {
      add(finding('FOREIGN_OBJECT', 'warning', '<foreignObject> embeds non-SVG content and needs a separate security and accessibility review.', node))
    }
    for (const [name] of node.attributes ?? []) {
      if (/^on[a-z]+$/i.test(name)) {
        add(finding('EVENT_HANDLER_ATTRIBUTE', 'error', `Inline ${name} handler introduces executable content.`, node, { attribute: name }))
      }
    }

    const linkValue = attribute(node, 'href') ?? attribute(node, 'xlink:href')
    const reference = resolvedReference(node, linkValue, baseCache)
    if (reference.controls) {
      add(finding('URL_CONTROL_CHARACTER', 'error', 'Reference contains URL control characters that can change downstream URL parsing.', node))
    }
    if (reference.kind === 'scriptable') {
      add(finding('SCRIPTABLE_REFERENCE', 'error', 'Reference uses a javascript: URL.', node, { scheme: 'javascript' }))
    }
    const baseReference = resolvedReference(node, attribute(node, 'xml:base'), baseCache)
    if (baseReference.kind === 'scriptable') {
      add(finding('SCRIPTABLE_BASE_REFERENCE', 'error', 'xml:base uses a javascript: URL.', node, { scheme: 'javascript' }))
    }

    const inlineStyle = attribute(node, 'style') ?? ''
    for (const value of [
      inlineStyle,
      attribute(node, 'fill') ?? '',
      attribute(node, 'stroke') ?? '',
      attribute(node, 'filter') ?? '',
      attribute(node, 'clip-path') ?? '',
      attribute(node, 'mask') ?? '',
      attribute(node, 'cursor') ?? '',
    ]) {
      const comparable = value.replace(/[\u0000-\u0020\u007f]/g, '')
      if (/url\(["']?javascript:/i.test(comparable)) {
        add(finding('SCRIPTABLE_STYLE_REFERENCE', 'error', 'Style value uses a javascript: URL.', node))
      } else if (/url\(["']?(?:https?:)?\/\//i.test(comparable)) {
        add(finding('CSS_REMOTE_RESOURCE', 'warning', 'Style value references a remote resource.', node))
      }
    }

    if (resourceElements.has(node.localName)) {
      const value = reference.resolved
      const kind = reference.kind
      if (kind === 'remote') {
        add(finding('REMOTE_RESOURCE_REFERENCE', 'warning', 'SVG resolves a remote resource at render time.', node, remoteReferenceEvidence(value)))
      } else if (kind === 'local-absolute' || kind === 'other-scheme') {
        add(finding('NON_PORTABLE_RESOURCE_REFERENCE', 'warning', 'SVG resource uses an absolute or non-web reference.', node, {
          kind,
          scheme: String(value).match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() ?? null,
        }))
      } else if (kind === 'data' && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value)) {
        add(finding('RISKY_DATA_REFERENCE', 'warning', 'Embedded data resource is not a common raster image format.', node, { mediaType: value.slice(0, 48) }))
      } else if (kind === 'fragment' && !idMap.has(reference.normalized.slice(1))) {
        add(finding('FRAGMENT_REFERENCE_BROKEN', 'error', `Reference points to missing id “${reference.normalized.slice(1)}”.`, node, { reference: reference.normalized }))
      }
    }

    if (node.localName === 'style') {
      const css = (node.text ?? []).join(' ')
      if (/@import\b/i.test(css)) {
        add(finding('CSS_IMPORT', 'warning', 'Embedded CSS imports an external stylesheet.', node))
      }
      if (/url\(\s*["']?(?:https?:)?\/\//i.test(css)) {
        add(finding('CSS_REMOTE_RESOURCE', 'warning', 'Embedded CSS references a remote resource.', node))
      }
    }
  }
  return findings
}

function compareFindings(left, right) {
  const severityOrder = { error: 0, warning: 1, info: 2 }
  return (severityOrder[left.severity] ?? 9) - (severityOrder[right.severity] ?? 9) ||
    (left.location?.offset ?? Number.MAX_SAFE_INTEGER) - (right.location?.offset ?? Number.MAX_SAFE_INTEGER) ||
    left.code.localeCompare(right.code)
}

/**
 * Audit an SVG string without rendering, fetching resources, or evaluating code.
 */
export function auditSvg(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('auditSvg expects an SVG string.')
  const limits = { ...DEFAULT_LIMITS, ...options }
  const byteLength = Buffer.byteLength(source)
  if (byteLength > limits.maxBytes) {
    return {
      validSvg: false,
      metadata: { bytes: byteLength, elementCount: 0, viewBox: null, decorative: false },
      findings: [finding('FILE_TOO_LARGE', 'error', `SVG exceeds the configured ${limits.maxBytes.toLocaleString()} byte limit.`)],
    }
  }

  const parsed = parseXml(source, {
    maxElements: limits.maxElements,
    maxDepth: limits.maxDepth,
    maxAttributes: limits.maxAttributes,
    maxDiagnostics: limits.maxDiagnostics,
  })
  const allElements = elements(parsed.document)
  const roots = parsed.document.children.filter((node) => node.localName === 'svg')
  const findings = parsed.errors.map((error) => ({
    code: error.code,
    severity: 'error',
    message: error.message,
    location: { line: error.line, column: error.column, offset: error.offset },
  }))
  for (const duplicate of parsed.duplicateAttributes) {
    findings.push({
      code: 'XML_ATTRIBUTE_DUPLICATE',
      severity: 'error',
      message: `${duplicate.element} repeats attribute(s): ${duplicate.names.join(', ')}.`,
      location: { line: duplicate.line, column: duplicate.column, offset: duplicate.offset },
    })
  }
  if (parsed.declarations.doctype) {
    findings.push(finding('DOCTYPE_DECLARATION', 'warning', 'DOCTYPE declarations are unnecessary in SVG and can create unsafe parser behavior elsewhere.'))
  }
  if (/<\?xml-stylesheet\b/i.test(source)) {
    findings.push(finding('EXTERNAL_STYLESHEET_INSTRUCTION', 'warning', 'An xml-stylesheet processing instruction may load external CSS in some renderers.'))
  }
  if (roots.length !== 1 || parsed.document.children.length !== 1) {
    findings.push(finding('SVG_ROOT_INVALID', 'error', `Expected exactly one top-level <svg> element; found ${parsed.document.children.length} top-level element(s).`))
  }

  const svg = roots[0]
  if (!svg) {
    return {
      validSvg: false,
      metadata: { bytes: byteLength, elementCount: parsed.elementCount, viewBox: null, decorative: false },
      findings: findings.sort(compareFindings),
    }
  }

  const idMap = new Map()
  for (const node of allElements) {
    const id = attribute(node, 'id')
    if (!id) continue
    if (idMap.has(id) && findings.length < limits.maxFindings) {
      findings.push(finding('ID_DUPLICATE', 'error', `Duplicate id “${id}” makes references ambiguous.`, node, {
        firstLocation: idMap.get(id).location,
      }))
    } else {
      idMap.set(id, node)
    }
  }

  const textCache = new WeakMap()
  const textFor = (node) => {
    if (!node) return ''
    if (!textCache.has(node)) textCache.set(node, elementText(node, { maxLength: 4_096 }))
    return textCache.get(node)
  }

  const viewBox = parseViewBox(attribute(svg, 'viewbox'))
  if (!viewBox.ok) {
    const messages = {
      missing: 'SVG has no viewBox, so responsive scaling and static layout checks are unreliable.',
      invalid: 'viewBox must contain exactly four finite numbers.',
      'non-positive': 'viewBox width and height must be greater than zero.',
    }
    findings.push(finding('VIEWBOX_INVALID', 'error', messages[viewBox.reason], svg, { reason: viewBox.reason }))
  }

  findings.push(...dimensionFindings(svg, viewBox))
  findings.push(...auditAccessibility(svg, allElements, idMap, textFor))
  findings.push(...auditActiveContent(allElements, idMap, { maxFindings: limits.maxFindings }))
  if (options.layout !== false) findings.push(...auditTextLayout(svg, allElements, viewBox, { ...options, maxFindings: limits.maxFindings }))

  if (findings.length > limits.maxFindings) {
    findings.length = limits.maxFindings
    findings.push(finding('AUDIT_FINDING_LIMIT', 'error', `Additional findings were omitted after ${limits.maxFindings.toLocaleString()} findings.`))
  }

  return {
    validSvg: findings.every((item) => !item.code.startsWith('XML_') && item.code !== 'SVG_ROOT_INVALID'),
    metadata: {
      bytes: byteLength,
      elementCount: parsed.elementCount,
      viewBox: viewBox.ok ? { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height } : null,
      width: attribute(svg, 'width'),
      height: attribute(svg, 'height'),
      decorative: isDecorative(svg),
      title: textFor(directChild(svg, 'title')) || null,
      description: textFor(directChild(svg, 'desc')) || null,
    },
    findings: findings.sort(compareFindings),
  }
}
