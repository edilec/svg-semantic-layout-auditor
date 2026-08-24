import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArguments, run } from '../src/cli.js'
import { formatTextReport } from '../src/report.js'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(repository, 'src', 'cli.js')

function execute(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: repository, encoding: 'utf8' })
}

test('argument parser accepts reproducible JSON reports', () => {
  const parsed = parseArguments(['examples', '--format', 'json', '--no-timestamp', '--fail-on', 'none'])
  assert.equal(parsed.action, 'audit')
  assert.equal(parsed.options.includeTimestamp, false)
  assert.equal(parsed.options.failOn, 'none')
})

test('JSON mode emits the documented schema', () => {
  const result = execute(['examples/accessible-card.svg', '--format', 'json', '--no-timestamp'])
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.schema, 'dev.edilec.svg-semantic-layout-audit.v1')
  assert.equal(report.summary.fileCount, 1)
  assert.equal(report.summary.findingCount, 0)
})

test('strict mode fails on warnings and error mode ignores warnings', () => {
  const defaultRun = execute(['examples/problematic.svg', '--no-layout'])
  const strictRun = execute(['examples/problematic.svg', '--no-layout', '--strict'])
  assert.equal(defaultRun.status, 1)
  assert.equal(strictRun.status, 1)

  const warningOnly = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-labelledby="title"><title id="title">Shape</title></svg>'
  const directory = path.join(os.tmpdir(), 'svg-auditor-cli-warning')
  return fs.mkdir(directory, { recursive: true })
    .then(() => fs.writeFile(path.join(directory, 'warning.svg'), warningOnly))
    .then(() => {
      assert.equal(execute([path.join(directory, 'warning.svg')]).status, 0)
      assert.equal(execute([path.join(directory, 'warning.svg'), '--strict']).status, 1)
    })
    .finally(() => fs.rm(directory, { recursive: true, force: true }))
})

test('output cannot overwrite an input SVG', () => {
  const result = execute(['examples/accessible-card.svg', '--output', 'examples/accessible-card.svg'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Refusing to overwrite/)
})

test('help and invalid options use conventional exit codes', () => {
  assert.equal(execute(['--help']).status, 0)
  const invalid = execute(['--unknown'])
  assert.equal(invalid.status, 2)
  assert.match(invalid.stderr, /Unknown option/)
})

test('text reports neutralize terminal control characters', () => {
  const rendered = formatTextReport({
    files: [{
      path: 'unsafe\u001b[31m.svg',
      findings: [{ code: 'TEST', severity: 'warning', message: 'bad\nmessage' }],
    }],
    summary: {
      fileCount: 1,
      findingCount: 1,
      bySeverity: { error: 0, warning: 1, info: 0 },
      skippedSymlinkCount: 0,
    },
  })
  assert.equal(rendered.includes('\u001b'), false)
  assert.equal(rendered.includes('\nbad'), false)
  assert.match(rendered, /unsafe�\[31m\.svg/)
})

test('CLI errors neutralize newlines, escapes, and bidi controls', async () => {
  let stderr = ''
  const status = await run(['--bad\n\u001b[31m\u202etest'], {
    stdout: { write() {} },
    stderr: { write(value) { stderr += value } },
  })
  assert.equal(status, 2)
  assert.equal(stderr.includes('\u001b'), false)
  assert.equal(stderr.includes('\u202e'), false)
  assert.equal(stderr.includes('--bad\n'), false)
})
