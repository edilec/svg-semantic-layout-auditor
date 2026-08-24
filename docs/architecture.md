# Architecture

## Design constraints

The auditor is intentionally dependency-free and static. An input SVG is
untrusted data: the tool must not render it, execute it, resolve entities, load
fonts, follow links, or access the network.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/xml.js` | Bounded structural parsing, indexed locations, and iterative text extraction; only built-in and numeric entities are decoded |
| `src/geometry.js` | Length, transform, aspect-ratio, and conservative text-bound calculations |
| `src/audit.js` | Accessibility, reference, active-content, ID, dimension, and layout rules |
| `src/files.js` | Bounded iterative discovery plus no-follow, regular-file, byte-limited reads |
| `src/report.js` | Stable report schema, summaries, text output, and failure thresholds |
| `src/output.js` | Symlink-aware parent checks and atomic report-file replacement |
| `src/cli.js` | Argument validation, output selection, and process exit codes |

## Data flow

1. The CLI validates options and requires one or more input paths.
2. Iterative discovery uses `lstat`, skips symbolic links, and applies separate
   budgets to input paths, entries, directories, depth, and matched SVG files.
3. Each selected path is opened once without following the final symbolic link,
   verified as a regular file, and read up to the byte limit from that handle.
4. The parser builds only the element, attribute, location, and text structure
   required by the rules. It does not create a browser DOM.
5. Rule modules return findings with codes, severity, source location, and
   small evidence objects.
6. The report layer sorts and aggregates the results.
7. Output goes to stdout unless the caller explicitly supplies `--output`; file
   output uses an exclusive temporary file and atomic replacement.

## Complexity controls

- bytes per file: 2 MiB by default;
- XML elements per file: 50,000 by default;
- XML nesting depth: 256 by default;
- attributes per element: 1,024 by default;
- parser diagnostics: 200 by default;
- emitted findings: 1,000 by default;
- files per run: 10,000 by default;
- visited filesystem entries: 100,000 by default; and
- layout checks are linear in the number of parsed elements.

Callers can reduce each limit for CI or untrusted uploads.

## Extension policy

New rules should be:

- statically decidable from the supplied SVG;
- deterministic across operating systems;
- narrow enough to explain with one actionable message;
- covered by a synthetic positive and negative test; and
- explicit about false positives and unsupported rendering behavior.

Browser-based checks belong in a separate optional integration, not in the
core package.
