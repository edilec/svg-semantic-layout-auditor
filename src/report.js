import path from 'node:path'

export const REPORT_SCHEMA = 'dev.edilec.svg-semantic-layout-audit.v1'

export function terminalSafe(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '�')
}

function displayPath(filePath, cwd) {
  const relative = path.relative(cwd, filePath)
  return relative && !relative.startsWith('..') ? relative : filePath
}

export function createReport(results, { cwd = process.cwd(), skippedSymlinks = [], includeTimestamp = true } = {}) {
  const files = results.map((result) => ({
    ...result,
    path: displayPath(result.path, cwd),
  }))
  const findings = files.flatMap((file) => file.findings.map((item) => ({ ...item, path: file.path })))
  const bySeverity = { error: 0, warning: 0, info: 0 }
  const byCode = {}
  for (const item of findings) {
    bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1
    byCode[item.code] = (byCode[item.code] ?? 0) + 1
  }
  return {
    schema: REPORT_SCHEMA,
    toolVersion: '0.1.0',
    ...(includeTimestamp ? { auditedAt: new Date().toISOString() } : {}),
    summary: {
      fileCount: files.length,
      cleanFileCount: files.filter((file) => file.findings.length === 0).length,
      affectedFileCount: files.filter((file) => file.findings.length > 0).length,
      findingCount: findings.length,
      bySeverity,
      byCode: Object.fromEntries(Object.entries(byCode).sort(([left], [right]) => left.localeCompare(right))),
      skippedSymlinkCount: skippedSymlinks.length,
    },
    files,
  }
}

export function formatTextReport(report) {
  const lines = []
  for (const file of report.files) {
    lines.push(`${file.findings.length === 0 ? '✓' : '•'} ${terminalSafe(file.path)}`)
    for (const item of file.findings) {
      const location = item.location?.line ? `:${item.location.line}:${item.location.column}` : ''
      lines.push(`  ${item.severity.toUpperCase().padEnd(7)} ${terminalSafe(item.code)}${location} ${terminalSafe(item.message)}`)
    }
  }
  lines.push('')
  lines.push(`${report.summary.fileCount} file(s), ${report.summary.findingCount} finding(s): ${report.summary.bySeverity.error} error, ${report.summary.bySeverity.warning} warning, ${report.summary.bySeverity.info} info.`)
  if (report.summary.skippedSymlinkCount > 0) lines.push(`${report.summary.skippedSymlinkCount} symbolic link(s) skipped.`)
  return `${lines.join('\n')}\n`
}

export function shouldFail(report, failOn) {
  if (failOn === 'none') return false
  if (failOn === 'warning') return report.summary.bySeverity.error > 0 || report.summary.bySeverity.warning > 0
  return report.summary.bySeverity.error > 0
}
