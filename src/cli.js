#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { auditPaths } from './files.js'
import { writeReportSafely } from './output.js'
import { createReport, formatTextReport, shouldFail, terminalSafe } from './report.js'

const HELP = `svg-semantic-layout-auditor

Static SVG accessibility, reference-safety, and text-layout checks.

Usage:
  svg-semantic-layout-auditor <file-or-directory...> [options]

Options:
  --format text|json       Output format (default: text)
  --output <path>          Write the report to a file
  --fail-on error|warning|none
                            Exit 1 at or above this severity (default: error)
  --strict                 Alias for --fail-on warning
  --no-layout              Skip estimated text-layout checks
  --max-bytes <number>     Maximum bytes per SVG (default: 2097152)
  --max-elements <number>  Maximum XML elements per SVG (default: 50000)
  --max-depth <number>     Maximum XML nesting depth (default: 256)
  --max-files <number>     Maximum SVG files per run (default: 10000)
  --max-entries <number>   Maximum visited filesystem entries (default: 100000)
  --no-timestamp           Omit auditedAt from JSON for reproducible output
  -h, --help               Show this help
  -v, --version            Show the version

The auditor never renders SVGs, fetches referenced resources, or executes code.
`

function valueAfter(args, index, option) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`)
  return value
}

function positiveInteger(value, option) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer.`)
  return parsed
}

export function parseArguments(args) {
  const options = {
    format: 'text',
    failOn: 'error',
    layout: true,
    maxBytes: 2 * 1024 * 1024,
    maxElements: 50_000,
    maxDepth: 256,
    maxFiles: 10_000,
    maxEntries: 100_000,
    includeTimestamp: true,
  }
  const inputs = []
  let output = null

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') return { action: 'help' }
    if (argument === '--version' || argument === '-v') return { action: 'version' }
    if (argument === '--strict') {
      options.failOn = 'warning'
      continue
    }
    if (argument === '--no-layout') {
      options.layout = false
      continue
    }
    if (argument === '--no-timestamp') {
      options.includeTimestamp = false
      continue
    }
    if (argument === '--format') {
      options.format = valueAfter(args, index, argument)
      index += 1
      if (!['text', 'json'].includes(options.format)) throw new Error('--format must be text or json.')
      continue
    }
    if (argument === '--output') {
      output = valueAfter(args, index, argument)
      index += 1
      continue
    }
    if (argument === '--fail-on') {
      options.failOn = valueAfter(args, index, argument)
      index += 1
      if (!['error', 'warning', 'none'].includes(options.failOn)) throw new Error('--fail-on must be error, warning, or none.')
      continue
    }
    if (['--max-bytes', '--max-elements', '--max-depth', '--max-files', '--max-entries'].includes(argument)) {
      const value = positiveInteger(valueAfter(args, index, argument), argument)
      index += 1
      if (argument === '--max-bytes') options.maxBytes = value
      if (argument === '--max-elements') options.maxElements = value
      if (argument === '--max-depth') options.maxDepth = value
      if (argument === '--max-files') options.maxFiles = value
      if (argument === '--max-entries') options.maxEntries = value
      continue
    }
    if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`)
    inputs.push(argument)
  }

  if (inputs.length === 0) throw new Error('Provide at least one SVG file or directory.')
  return { action: 'audit', inputs, output, options }
}

export async function run(args, io = { stdout: process.stdout, stderr: process.stderr }) {
  let parsed
  try {
    parsed = parseArguments(args)
  } catch (error) {
    io.stderr.write(`Error: ${terminalSafe(error.message)}\n\n${HELP}`)
    return 2
  }

  if (parsed.action === 'help') {
    io.stdout.write(HELP)
    return 0
  }
  if (parsed.action === 'version') {
    io.stdout.write('0.1.0\n')
    return 0
  }

  try {
    const audited = await auditPaths(parsed.inputs, parsed.options)
    if (audited.files.length === 0) throw new Error('No .svg files found in the supplied inputs.')

    const outputPath = parsed.output ? path.resolve(parsed.output) : null
    if (outputPath && audited.files.includes(outputPath)) {
      throw new Error('Refusing to overwrite an input SVG with the report.')
    }

    const report = createReport(audited.results, {
      cwd: process.cwd(),
      skippedSymlinks: audited.skippedSymlinks,
      includeTimestamp: parsed.options.includeTimestamp,
    })
    const rendered = parsed.options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatTextReport(report)
    if (outputPath) {
      await writeReportSafely(outputPath, rendered)
      io.stdout.write(`Report written to ${terminalSafe(outputPath)}\n`)
    } else {
      io.stdout.write(rendered)
    }
    return shouldFail(report, parsed.options.failOn) ? 1 : 0
  } catch (error) {
    io.stderr.write(`Error: ${terminalSafe(error.message)}\n`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2))
}
