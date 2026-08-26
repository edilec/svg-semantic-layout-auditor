# SVG Semantic Layout Auditor

[![CI](https://github.com/edilec/svg-semantic-layout-auditor/actions/workflows/ci.yml/badge.svg)](https://github.com/edilec/svg-semantic-layout-auditor/actions/workflows/ci.yml)
[![CodeQL](https://github.com/edilec/svg-semantic-layout-auditor/actions/workflows/codeql.yml/badge.svg)](https://github.com/edilec/svg-semantic-layout-auditor/actions/workflows/codeql.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)

A dependency-free Node.js CLI and library for static SVG accessibility,
reference-safety, dimension, and text-layout checks.

> **Maturity:** experimental `0.1.0`. The rule set and JSON schema may
> change before `1.0.0`. This repository has not been published to npm.

## Why it exists

SVGs can be valid XML and still fail in production: an unlabelled diagram is
opaque to assistive technology, a remote `<image>` creates an unexpected
runtime dependency, duplicate IDs break references, and a long label can leave
its card or viewBox. Those problems are easy to miss in a large media library.

This auditor provides a deterministic first pass that can run in local checks
or CI without opening a browser, loading fonts, making network requests, or
executing the SVG.

## What it checks

| Area | Representative checks |
| --- | --- |
| Structure | XML tag balance, one top-level `<svg>`, byte, depth, attribute, diagnostic, and element limits |
| Accessibility | direct `<title>` and `<desc>`, empty metadata, broken `aria-labelledby` |
| Canvas | valid positive `viewBox`, incomplete dimensions, aspect-ratio mismatch |
| References | duplicate IDs, broken fragments, URL controls, effective `xml:base`, remote or non-portable resources |
| Active content | `<script>`, inline event handlers, `<foreignObject>`, CSS imports |
| Layout heuristics | estimated text overflow beyond the viewBox or a marked card/box |

Decorative SVGs marked with `aria-hidden="true"`, `role="none"`, or
`role="presentation"` are not required to have a title or description.

## Requirements

- Node.js 20 or newer
- no runtime dependencies

## Quick start

Clone the repository, then run the CLI directly:

```sh
node ./src/cli.js examples/accessible-card.svg
node ./src/cli.js examples --format json --output reports/svg-audit.json
node ./src/cli.js public/media --strict
```

The default failure threshold is `error`. Use `--strict` (equivalent to
`--fail-on warning`) when warnings should block a build, or `--fail-on none`
when collecting a baseline report.

```text
Usage:
  svg-semantic-layout-auditor <file-or-directory...> [options]

Options:
  --format text|json
  --output <path>
  --fail-on error|warning|none
  --strict
  --no-layout
  --max-bytes <number>
  --max-elements <number>
  --max-depth <number>
  --max-files <number>
  --max-entries <number>
  --no-timestamp
```

Directories are searched with bounded iterative traversal. Symbolic links,
`.git`, and `node_modules` are skipped. Input files are opened once with
no-follow semantics, verified as regular files, and read only up to the byte
ceiling. Reports use a same-directory temporary file and atomic replacement;
symbolic-link destinations and existing symbolic-link parent components are
refused.

## Library usage

```js
import { auditSvg, createReport } from '@edilec/svg-semantic-layout-auditor'

const result = auditSvg(svgSource, {
  maxBytes: 2 * 1024 * 1024,
  maxElements: 50_000,
  maxDepth: 256,
  maxFindings: 1_000,
  layout: true,
})

const report = createReport([
  { path: 'diagram.svg', ...result },
], { includeTimestamp: false })

if (report.summary.bySeverity.error > 0) {
  throw new Error('SVG audit failed')
}
```

The JSON report schema is
`dev.edilec.svg-semantic-layout-audit.v1`. Use `--no-timestamp` for
reproducible fixtures or release comparisons. See the committed
[example JSON report](./examples/report.json) for the complete clean-result
shape.

## Marking layout containers

The layout pass looks for a `<rect>` inside the nearest ancestor `<g>` when the
group or rectangle has:

- `data-audit-container="true"`; or
- a class token named `box`, `card`, `cell`, `node`, `panel`, or `tile`.

```svg
<g class="card">
  <rect class="card" x="20" y="20" width="180" height="80"/>
  <text x="110" y="65" text-anchor="middle" font-size="18">Queued</text>
</g>
```

Text width is estimated from visible characters, inline font size, letter
spacing, anchors, and SVG transform matrices. The auditor uses conservative
tolerances, but the result is still a heuristic.

## Limits and non-goals

This tool does not:

- replace browser, screen-reader, keyboard, or visual regression testing;
- load web fonts or reproduce browser font metrics;
- execute CSS layout, SMIL, scripts, filters, or embedded HTML;
- establish that linked content is trustworthy merely because it is local;
- sanitize SVGs or rewrite findings automatically;
- fetch or crawl any URL; or
- judge whether a diagram's wording is factually relevant to surrounding copy.

False positives are possible for text using external stylesheets, unusual font
metrics, text paths, complex animation, or runtime mutations. Treat layout
findings as focused review prompts and confirm them in the supported browsers.
Use `--no-layout` when only deterministic structure and reference checks are
appropriate.

The XML parser deliberately supports only the structural subset needed by the
rules. Metadata excerpts are bounded, diagnostics are truncated after a
configured ceiling, and URL checks model common browser resolution rules but
do not prove safety in every embedding context.

## Architecture

The CLI follows a deliberately small, read-only pipeline:

```text
files/directories
      │
      ▼
bounded discovery ── skips symlinks and special files
      │
      ▼
bounded no-follow read → non-evaluating XML structure parser
      │
      ├── accessibility and ID checks
      ├── active/external reference checks
      ├── viewBox and dimension checks
      └── conservative text geometry estimates
      │
      ▼
deterministic text or JSON report
      │
      └── optional symlink-safe atomic file replacement
```

Read [docs/architecture.md](./docs/architecture.md) for module boundaries,
[docs/rules.md](./docs/rules.md) for the rule catalog, and
[docs/threat-model.md](./docs/threat-model.md) for security assumptions.

## Development

```sh
npm test
npm run test:coverage
npm run check
```

`npm run check` validates source syntax, runs all synthetic tests with Node's
built-in coverage reporter, and inspects the package tarball contents. See
[CONTRIBUTING.md](./CONTRIBUTING.md) before proposing a change.

## Provenance

This repository is a clean, generalized extraction from SVG quality controls
owned by Edilec Private Limited. It contains no production article corpus,
rendered media library, audit output, browser profile, customer data, or
internal path configuration. The extraction boundary is documented in
[PROVENANCE.md](./PROVENANCE.md).

## Security, support, and licence

Report vulnerabilities privately using [SECURITY.md](./SECURITY.md). Use
[SUPPORT.md](./SUPPORT.md) for normal questions and false-positive reports.

Licensed under the [MIT License](./LICENSE). Copyright © 2026 Edilec Private
Limited.
