const BUILTIN_ENTITIES = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['quot', '"'],
])

const MAX_ENTITY_NAME = 32

function createLocator(source) {
  const lineStarts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) lineStarts.push(index + 1)
  }

  return (offset) => {
    let low = 0
    let high = lineStarts.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (lineStarts[middle] <= offset) low = middle + 1
      else high = middle
    }
    const lineIndex = Math.max(0, low - 1)
    return { line: lineIndex + 1, column: offset - lineStarts[lineIndex] + 1, offset }
  }
}

function findTagEnd(source, start) {
  let quote = null
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '>') return index
  }
  return -1
}

function decodeEntity(entity) {
  if (BUILTIN_ENTITIES.has(entity)) return BUILTIN_ENTITIES.get(entity)
  if (/^#x[0-9a-f]+$/i.test(entity)) {
    const value = Number.parseInt(entity.slice(2), 16)
    return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value)
      : `&${entity};`
  }
  if (/^#[0-9]+$/.test(entity)) {
    const value = Number.parseInt(entity.slice(1), 10)
    return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value)
      : `&${entity};`
  }
  return `&${entity};`
}

/** Decode built-in and numeric XML entities with a bounded, single-pass scanner. */
export function decodeXmlText(value) {
  const source = String(value ?? '')
  const output = []
  let cursor = 0
  while (cursor < source.length) {
    const ampersand = source.indexOf('&', cursor)
    if (ampersand === -1) {
      output.push(source.slice(cursor))
      break
    }
    output.push(source.slice(cursor, ampersand))
    const searchEnd = Math.min(source.length, ampersand + MAX_ENTITY_NAME + 2)
    let semicolon = -1
    for (let index = ampersand + 1; index < searchEnd; index += 1) {
      if (source[index] === ';') {
        semicolon = index
        break
      }
      if (source[index] === '&' || /\s/.test(source[index])) break
    }
    if (semicolon === -1) {
      output.push('&')
      cursor = ampersand + 1
      continue
    }
    const entity = source.slice(ampersand + 1, semicolon)
    if (!entity || /[&\s]/.test(entity)) {
      output.push('&')
      cursor = ampersand + 1
      continue
    }
    output.push(decodeEntity(entity))
    cursor = semicolon + 1
  }
  return output.join('')
}

function parseAttributes(raw, rawOffset, locate, { maxAttributes, addError }) {
  const attributes = new Map()
  const duplicates = []
  let cursor = 0
  let attributeCount = 0

  while (cursor < raw.length) {
    while (/\s/.test(raw[cursor] ?? '')) cursor += 1
    if (cursor >= raw.length) break
    if (attributeCount >= maxAttributes) {
      addError({
        code: 'XML_ATTRIBUTE_LIMIT',
        message: `Element exceeds the configured ${maxAttributes.toLocaleString()} attribute limit.`,
        ...locate(rawOffset + cursor),
      })
      break
    }

    const nameMatch = raw.slice(cursor).match(/^([^\s=/>]+)/)
    if (!nameMatch) {
      addError({ code: 'XML_ATTRIBUTE_INVALID', message: 'Could not parse an attribute name.', ...locate(rawOffset + cursor) })
      break
    }

    const name = nameMatch[1]
    const normalizedName = name.toLowerCase()
    cursor += name.length
    while (/\s/.test(raw[cursor] ?? '')) cursor += 1

    let value = ''
    if (raw[cursor] === '=') {
      cursor += 1
      while (/\s/.test(raw[cursor] ?? '')) cursor += 1
      const quote = raw[cursor]
      if (quote === '"' || quote === "'") {
        cursor += 1
        const end = raw.indexOf(quote, cursor)
        if (end === -1) {
          addError({ code: 'XML_ATTRIBUTE_UNCLOSED', message: `Attribute ${name} has no closing quote.`, ...locate(rawOffset + cursor) })
          break
        }
        value = raw.slice(cursor, end)
        cursor = end + 1
      } else {
        const valueMatch = raw.slice(cursor).match(/^([^\s/>]+)/)
        addError({ code: 'XML_ATTRIBUTE_UNQUOTED', message: `Attribute ${name} must use a quoted value.`, ...locate(rawOffset + cursor) })
        if (!valueMatch) break
        value = valueMatch[1]
        cursor += value.length
      }
    }

    if (attributes.has(normalizedName)) duplicates.push(name)
    attributes.set(normalizedName, decodeXmlText(value))
    attributeCount += 1
  }

  return { attributes, duplicates }
}

function makeElement(name, attributes, location, parent) {
  return {
    type: 'element',
    name,
    localName: name.toLowerCase().split(':').at(-1),
    attributes,
    children: [],
    text: [],
    parent,
    location,
  }
}

/**
 * Parse only the XML structure needed for static SVG auditing.
 * External entities are never expanded, fetched, or evaluated.
 */
export function parseXml(source, {
  maxElements = 50_000,
  maxDepth = 256,
  maxAttributes = 1_024,
  maxDiagnostics = 200,
  maxTextSegments = 100_000,
} = {}) {
  const document = { type: 'document', children: [], parent: null, text: [] }
  const stack = [document]
  const errors = []
  const duplicateAttributes = []
  const declarations = { doctype: false }
  const locate = createLocator(source)
  let diagnosticsTruncated = false
  let elementCount = 0
  let textSegmentCount = 0
  let cursor = 0

  const addError = (error) => {
    if (errors.length < maxDiagnostics) errors.push(error)
    else diagnosticsTruncated = true
  }
  const addText = (node, text) => {
    if (!text || textSegmentCount >= maxTextSegments) return
    node.text.push(text)
    textSegmentCount += 1
  }

  while (cursor < source.length) {
    const opening = source.indexOf('<', cursor)
    if (opening === -1) {
      addText(stack.at(-1), decodeXmlText(source.slice(cursor)))
      break
    }

    if (opening > cursor) addText(stack.at(-1), decodeXmlText(source.slice(cursor, opening)))

    if (source.startsWith('<!--', opening)) {
      const end = source.indexOf('-->', opening + 4)
      if (end === -1) {
        addError({ code: 'XML_COMMENT_UNCLOSED', message: 'Unclosed XML comment.', ...locate(opening) })
        break
      }
      cursor = end + 3
      continue
    }

    if (source.startsWith('<![CDATA[', opening)) {
      const end = source.indexOf(']]>', opening + 9)
      if (end === -1) {
        addError({ code: 'XML_CDATA_UNCLOSED', message: 'Unclosed CDATA section.', ...locate(opening) })
        break
      }
      addText(stack.at(-1), source.slice(opening + 9, end))
      cursor = end + 3
      continue
    }

    if (/^<!doctype\b/i.test(source.slice(opening, opening + 12))) {
      declarations.doctype = true
      const end = findTagEnd(source, opening + 2)
      if (end === -1) {
        addError({ code: 'XML_DOCTYPE_UNCLOSED', message: 'Unclosed DOCTYPE declaration.', ...locate(opening) })
        break
      }
      cursor = end + 1
      continue
    }

    if (source.startsWith('<?', opening)) {
      const end = source.indexOf('?>', opening + 2)
      if (end === -1) {
        addError({ code: 'XML_PROCESSING_INSTRUCTION_UNCLOSED', message: 'Unclosed processing instruction.', ...locate(opening) })
        break
      }
      cursor = end + 2
      continue
    }

    if (source.startsWith('</', opening)) {
      const end = findTagEnd(source, opening + 2)
      if (end === -1) {
        addError({ code: 'XML_TAG_UNCLOSED', message: 'Unclosed closing tag.', ...locate(opening) })
        break
      }
      const closingName = source.slice(opening + 2, end).trim().split(/\s/)[0]?.toLowerCase()
      const current = stack.at(-1)
      if (stack.length === 1) {
        addError({ code: 'XML_CLOSE_UNEXPECTED', message: `Unexpected closing tag </${closingName}>.`, ...locate(opening) })
      } else if (current.name.toLowerCase() !== closingName) {
        addError({ code: 'XML_TAG_MISMATCH', message: `Expected </${current.name}> but found </${closingName}>.`, ...locate(opening) })
        stack.pop()
      } else {
        stack.pop()
      }
      cursor = end + 1
      continue
    }

    if (source.startsWith('<!', opening)) {
      const end = findTagEnd(source, opening + 2)
      if (end === -1) {
        addError({ code: 'XML_DECLARATION_UNCLOSED', message: 'Unclosed XML declaration.', ...locate(opening) })
        break
      }
      cursor = end + 1
      continue
    }

    const end = findTagEnd(source, opening + 1)
    if (end === -1) {
      addError({ code: 'XML_TAG_UNCLOSED', message: 'Unclosed opening tag.', ...locate(opening) })
      break
    }

    let body = source.slice(opening + 1, end)
    const selfClosing = /\/\s*$/.test(body)
    if (selfClosing) body = body.replace(/\/\s*$/, '')
    const nameMatch = body.match(/^\s*([^\s/>]+)/)
    if (!nameMatch) {
      addError({ code: 'XML_TAG_NAME_MISSING', message: 'Opening tag has no name.', ...locate(opening) })
      cursor = end + 1
      continue
    }

    if (elementCount >= maxElements) {
      addError({ code: 'XML_ELEMENT_LIMIT', message: `SVG exceeds the configured ${maxElements.toLocaleString()} element limit.`, ...locate(opening) })
      break
    }
    const depth = stack.length
    if (depth > maxDepth) {
      addError({ code: 'XML_DEPTH_LIMIT', message: `SVG exceeds the configured ${maxDepth.toLocaleString()} nesting-depth limit.`, ...locate(opening) })
      break
    }

    const name = nameMatch[1]
    const attributeStart = body.indexOf(name) + name.length
    const rawAttributes = body.slice(attributeStart)
    const parsedAttributes = parseAttributes(rawAttributes, opening + 1 + attributeStart, locate, {
      maxAttributes,
      addError,
    })
    if (parsedAttributes.duplicates.length > 0 && duplicateAttributes.length < maxDiagnostics) {
      duplicateAttributes.push({ names: parsedAttributes.duplicates.slice(0, maxAttributes), element: name, ...locate(opening) })
    } else if (parsedAttributes.duplicates.length > 0) {
      diagnosticsTruncated = true
    }

    const parent = stack.at(-1)
    const element = makeElement(name, parsedAttributes.attributes, locate(opening), parent)
    parent.children.push(element)
    elementCount += 1
    if (!selfClosing) stack.push(element)
    cursor = end + 1
  }

  if (stack.length > 1) {
    const unclosed = stack.slice(1, 33).map((node) => node.name)
    const suffix = stack.length > 33 ? ', …' : ''
    addError({ code: 'XML_TAGS_UNCLOSED', message: `Unclosed tags: ${unclosed.join(', ')}${suffix}.`, ...stack.at(-1).location })
  }
  if (textSegmentCount >= maxTextSegments) {
    addError({ code: 'XML_TEXT_SEGMENT_LIMIT', message: `SVG exceeds the configured ${maxTextSegments.toLocaleString()} text-segment limit.`, ...locate(cursor) })
  }
  if (diagnosticsTruncated) {
    errors.push({ code: 'XML_DIAGNOSTIC_LIMIT', message: `Additional XML diagnostics were omitted after ${maxDiagnostics.toLocaleString()} findings.`, ...locate(cursor) })
  }

  return { document, errors, duplicateAttributes, declarations, elementCount }
}

export function elements(root) {
  const result = []
  const stack = [...(root.children ?? [])].reverse()
  while (stack.length > 0) {
    const node = stack.pop()
    result.push(node)
    for (let index = (node.children?.length ?? 0) - 1; index >= 0; index -= 1) stack.push(node.children[index])
  }
  return result
}

export function attribute(node, name) {
  return node.attributes?.get(name.toLowerCase()) ?? null
}

export function elementText(node, { maxLength = 65_536 } = {}) {
  if (!node || maxLength <= 0) return ''
  const parts = []
  let length = 0
  const stack = [node]
  while (stack.length > 0 && length < maxLength) {
    const current = stack.pop()
    for (const text of current.text ?? []) {
      const remaining = maxLength - length
      if (remaining <= 0) break
      const portion = text.slice(0, remaining)
      parts.push(portion)
      length += portion.length
    }
    for (let index = (current.children?.length ?? 0) - 1; index >= 0; index -= 1) stack.push(current.children[index])
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function directChild(node, localName) {
  return (node.children ?? []).find((child) => child.localName === localName) ?? null
}
