import { attribute, elementText } from './xml.js'

const IDENTITY = [1, 0, 0, 1, 0, 0]
const CONTAINER_CLASS = /(?:^|\s)(?:box|card|cell|node|panel|tile)(?:\s|$)/i

function multiply(left, right) {
  const [a, b, c, d, e, f] = left
  const [g, h, i, j, k, l] = right
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ]
}

function translate(x, y = 0) {
  return [1, 0, 0, 1, x, y]
}

function scale(x, y = x) {
  return [x, 0, 0, y, 0, 0]
}

function rotate(degrees, cx = 0, cy = 0) {
  const radians = degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return multiply(translate(cx, cy), multiply([cosine, sine, -sine, cosine, 0, 0], translate(-cx, -cy)))
}

function skewX(degrees) {
  return [1, 0, Math.tan(degrees * Math.PI / 180), 1, 0, 0]
}

function skewY(degrees) {
  return [1, Math.tan(degrees * Math.PI / 180), 0, 1, 0, 0]
}

function numbers(value) {
  return String(value ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
}

export function parseTransform(value) {
  if (!value) return { matrix: IDENTITY, unsupported: [] }
  let matrix = IDENTITY
  const unsupported = []
  const matched = new Set()
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let match
  while ((match = pattern.exec(value)) !== null) {
    matched.add(match.index)
    const operation = match[1].toLowerCase()
    const args = numbers(match[2])
    let next = null
    if (operation === 'matrix' && args.length === 6) next = args
    if (operation === 'translate' && args.length >= 1) next = translate(args[0], args[1] ?? 0)
    if (operation === 'scale' && args.length >= 1) next = scale(args[0], args[1] ?? args[0])
    if (operation === 'rotate' && (args.length === 1 || args.length >= 3)) next = rotate(args[0], args[1] ?? 0, args[2] ?? 0)
    if (operation === 'skewx' && args.length === 1) next = skewX(args[0])
    if (operation === 'skewy' && args.length === 1) next = skewY(args[0])
    if (next) matrix = multiply(matrix, next)
    else unsupported.push(match[0])
  }
  if (matched.size === 0 && value.trim()) unsupported.push(value.trim())
  return { matrix, unsupported }
}

function point(matrix, x, y) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  }
}

function transformedBox(box, matrix) {
  const corners = [
    point(matrix, box.x, box.y),
    point(matrix, box.x + box.width, box.y),
    point(matrix, box.x + box.width, box.y + box.height),
    point(matrix, box.x, box.y + box.height),
  ]
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

export function parseLength(value) {
  if (value == null || value === '') return null
  const match = String(value).trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)\s*(px)?$/i)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

export function parseViewBox(value) {
  if (value == null) return { ok: false, reason: 'missing' }
  const source = String(value).trim()
  const tokens = source ? source.split(/[\s,]+/) : []
  const numberPattern = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?$/i
  if (tokens.length !== 4 || tokens.some((item) => !numberPattern.test(item))) {
    return { ok: false, reason: 'invalid' }
  }
  const values = tokens.map(Number)
  if (values.some((item) => !Number.isFinite(item))) return { ok: false, reason: 'invalid' }
  const [x, y, width, height] = values
  if (width <= 0 || height <= 0) return { ok: false, reason: 'non-positive' }
  return { ok: true, x, y, width, height }
}

function styleMap(node) {
  const declarations = new Map()
  for (const declaration of String(attribute(node, 'style') ?? '').split(';')) {
    const separator = declaration.indexOf(':')
    if (separator === -1) continue
    declarations.set(declaration.slice(0, separator).trim().toLowerCase(), declaration.slice(separator + 1).trim())
  }
  return declarations
}

function ownText(node) {
  return (node.text ?? []).join(' ').replace(/\s+/g, ' ').trim()
}

function estimatedTextWidth(text, fontSize, letterSpacing) {
  let units = 0
  for (const character of text) {
    if (/\s/.test(character)) units += 0.33
    else if (/[A-Z]/.test(character)) units += 0.66
    else if (/[a-z]/.test(character)) units += 0.54
    else if (/[0-9]/.test(character)) units += 0.56
    else if (/[\u2E80-\u9FFF\u{1F300}-\u{1FAFF}]/u.test(character)) units += 1
    else units += 0.38
  }
  return units * fontSize + Math.max(0, text.length - 1) * letterSpacing
}

function matrixFor(node, cache) {
  if (!node || node.type !== 'element') return IDENTITY
  if (cache.has(node)) return cache.get(node)
  const pending = []
  let current = node
  while (current?.type === 'element' && !cache.has(current)) {
    pending.push(current)
    current = current.parent
  }
  let matrix = current?.type === 'element' ? cache.get(current) : IDENTITY
  while (pending.length > 0) {
    const item = pending.pop()
    matrix = multiply(matrix, parseTransform(attribute(item, 'transform')).matrix)
    cache.set(item, matrix)
  }
  return cache.get(node)
}

function rectFor(node, cache) {
  const x = parseLength(attribute(node, 'x')) ?? 0
  const y = parseLength(attribute(node, 'y')) ?? 0
  const width = parseLength(attribute(node, 'width'))
  const height = parseLength(attribute(node, 'height'))
  if (width == null || height == null || width < 0 || height < 0) return null
  return transformedBox({ x, y, width, height }, matrixFor(node, cache))
}

function ownValue(node, styles, attributeName, styleName = attributeName) {
  const direct = attribute(node, attributeName)
  return direct ?? styles.get(styleName) ?? null
}

function createLayoutContexts(allElements) {
  const contexts = new WeakMap()
  const matrixCache = new WeakMap()
  const groupContainers = new WeakMap()
  const nonRenderedNames = new Set(['defs', 'symbol', 'clippath', 'mask', 'marker', 'pattern', 'textpath'])

  for (const node of allElements) {
    if (node.localName !== 'g') continue
    const groupMarked = attribute(node, 'data-audit-container') === 'true' || CONTAINER_CLASS.test(attribute(node, 'class') ?? '')
    const rect = (node.children ?? []).find((child) => child.localName === 'rect' && (
      groupMarked ||
      attribute(child, 'data-audit-container') === 'true' ||
      CONTAINER_CLASS.test(attribute(child, 'class') ?? '')
    ))
    groupContainers.set(node, rect ?? null)
  }

  for (const node of allElements) {
    const parent = node.parent?.type === 'element' ? contexts.get(node.parent) : null
    const styles = styleMap(node)
    const display = ownValue(node, styles, 'display') ?? parent?.display ?? null
    const visibility = ownValue(node, styles, 'visibility') ?? parent?.visibility ?? null
    const opacityRaw = ownValue(node, styles, 'opacity') ?? parent?.opacityRaw ?? null
    const opacity = opacityRaw == null ? Number.NaN : Number(opacityRaw)
    const ownX = parseLength(attribute(node, 'x'))
    const ownY = parseLength(attribute(node, 'y'))
    const inheritCoordinates = node.parent?.localName !== 'svg'
    const parentContainerNode = parent?.containerNode ?? null
    const localContainerNode = node.parent?.localName === 'g' ? groupContainers.get(node.parent) : null
    const matrix = multiply(parent?.matrix ?? IDENTITY, parseTransform(attribute(node, 'transform')).matrix)
    matrixCache.set(node, matrix)
    contexts.set(node, {
      matrix,
      display,
      visibility,
      opacityRaw,
      hidden: Boolean(parent?.hidden) || String(display).toLowerCase() === 'none' ||
        ['hidden', 'collapse'].includes(String(visibility).toLowerCase()) ||
        (Number.isFinite(opacity) && opacity <= 0),
      nonRendered: Boolean(parent?.nonRendered) || nonRenderedNames.has(node.localName),
      fontSize: ownValue(node, styles, 'font-size') ?? parent?.fontSize ?? null,
      letterSpacing: ownValue(node, styles, 'letter-spacing') ?? parent?.letterSpacing ?? null,
      textAnchor: ownValue(node, styles, 'text-anchor') ?? parent?.textAnchor ?? null,
      x: ownX ?? (inheritCoordinates ? parent?.x : null) ?? 0,
      y: ownY ?? (inheritCoordinates ? parent?.y : null) ?? 0,
      containerNode: localContainerNode ?? parentContainerNode,
    })
  }
  return { contexts, matrixCache }
}

function outside(box, container, tolerance) {
  return box.x < container.x - tolerance ||
    box.y < container.y - tolerance ||
    box.x + box.width > container.x + container.width + tolerance ||
    box.y + box.height > container.y + container.height + tolerance
}

function overflowAmount(box, container) {
  return Math.max(
    container.x - box.x,
    container.y - box.y,
    box.x + box.width - (container.x + container.width),
    box.y + box.height - (container.y + container.height),
    0,
  )
}

function roundedBox(box) {
  return Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Number(value.toFixed(2))]))
}

/**
 * Estimate whether inline SVG text may leave its viewBox or a marked card.
 * This is deliberately conservative and cannot replace browser rendering.
 */
export function auditTextLayout(svg, allElements, viewBox, { tolerance = 2, maxFindings = 1_000 } = {}) {
  if (!viewBox?.ok) return []
  const findings = []
  const { contexts, matrixCache } = createLayoutContexts(allElements)
  const containerBoxCache = new WeakMap()
  const viewBoxRect = { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height }

  for (const node of allElements) {
    if (findings.length >= maxFindings) break
    if (node.localName !== 'text' && node.localName !== 'tspan') continue
    const context = contexts.get(node)
    if (context.nonRendered || context.hidden) continue
    const text = ownText(node) || (node.localName === 'text' && node.children.length === 0 ? elementText(node) : '')
    if (!text) continue

    const fontSize = parseLength(context.fontSize) ?? 16
    const letterSpacing = parseLength(context.letterSpacing) ?? 0
    const x = context.x + (parseLength(attribute(node, 'dx')) ?? 0)
    const y = context.y + (parseLength(attribute(node, 'dy')) ?? 0)
    const width = estimatedTextWidth(text, fontSize, letterSpacing)
    const textAnchor = String(context.textAnchor ?? 'start').toLowerCase()
    const anchoredX = textAnchor === 'middle' ? x - width / 2 : textAnchor === 'end' ? x - width : x
    const localBox = { x: anchoredX, y: y - fontSize * 0.82, width, height: fontSize }
    const box = transformedBox(localBox, matrixFor(node, matrixCache))
    const viewOverflow = overflowAmount(box, viewBoxRect)
    const conservativeThreshold = Math.max(tolerance, fontSize * 0.4)

    if (outside(box, viewBoxRect, conservativeThreshold)) {
      findings.push({
        code: 'TEXT_MAY_OVERFLOW_VIEWBOX',
        severity: 'warning',
        message: `Estimated bounds for “${text.slice(0, 64)}” extend beyond the SVG viewBox.`,
        location: node.location,
        evidence: { estimatedBox: roundedBox(box), viewBox: roundedBox(viewBoxRect), overflow: Number(viewOverflow.toFixed(2)) },
      })
    }

    const containerNode = context.containerNode
    let container = null
    if (containerNode) {
      if (!containerBoxCache.has(containerNode)) containerBoxCache.set(containerNode, rectFor(containerNode, matrixCache))
      container = containerBoxCache.get(containerNode)
    }
    if (container) {
      const containerOverflow = overflowAmount(box, container)
      const containerThreshold = Math.max(tolerance, Math.min(fontSize * 0.5, container.width * 0.04))
      if (outside(box, container, containerThreshold)) {
        findings.push({
          code: 'TEXT_MAY_OVERFLOW_CONTAINER',
          severity: 'warning',
          message: `Estimated bounds for “${text.slice(0, 64)}” extend beyond its nearest marked card or box.`,
          location: node.location,
          evidence: { estimatedBox: roundedBox(box), container: roundedBox(container), overflow: Number(containerOverflow.toFixed(2)) },
        })
      }
    }
  }

  return findings
}

export function dimensionFindings(svg, viewBox) {
  const findings = []
  const widthRaw = attribute(svg, 'width')
  const heightRaw = attribute(svg, 'height')
  const width = parseLength(widthRaw)
  const height = parseLength(heightRaw)

  if ((widthRaw == null) !== (heightRaw == null)) {
    findings.push({
      code: 'DIMENSIONS_INCOMPLETE',
      severity: 'warning',
      message: 'Specify both width and height, or omit both for a responsive SVG.',
      location: svg.location,
    })
  }
  for (const [name, raw, parsed] of [['width', widthRaw, width], ['height', heightRaw, height]]) {
    if (raw != null && parsed != null && parsed <= 0) {
      findings.push({
        code: 'DIMENSION_NON_POSITIVE',
        severity: 'error',
        message: `${name} must be greater than zero.`,
        location: svg.location,
      })
    }
  }
  if (viewBox.ok && width > 0 && height > 0) {
    const declaredRatio = width / height
    const viewBoxRatio = viewBox.width / viewBox.height
    const mismatch = Math.abs(declaredRatio - viewBoxRatio) / viewBoxRatio
    const preserve = String(attribute(svg, 'preserveaspectratio') ?? '').toLowerCase()
    if (mismatch > 0.02 && preserve !== 'none') {
      findings.push({
        code: 'ASPECT_RATIO_MISMATCH',
        severity: 'warning',
        message: 'Declared dimensions and viewBox use different aspect ratios.',
        location: svg.location,
        evidence: {
          declaredRatio: Number(declaredRatio.toFixed(4)),
          viewBoxRatio: Number(viewBoxRatio.toFixed(4)),
        },
      })
    }
  }
  return findings
}
