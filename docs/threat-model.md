# Threat model

## Assets

- the integrity and availability of the host running the CLI;
- confidentiality of local files outside the requested inputs;
- integrity of audited SVG files;
- reliability of CI results; and
- safety of downstream applications that use the report as review evidence.

## Trust boundaries

SVG bytes, filenames, directory entries, XML attributes, CSS text, and report
paths are caller-controlled. The local filesystem and explicit command-line
configuration are trusted only to the extent granted by the invoking user.

## Attacker capabilities

An attacker may provide a malformed, deeply nested, oversized, script-bearing,
or reference-heavy SVG inside an explicitly audited path. They may choose
names and text that appear in terminal or JSON output.

## Security objectives

- Never execute or render the SVG.
- Never expand external XML entities.
- Never make network requests or follow resource references.
- Bound discovery work, file size, XML depth, attributes, diagnostics,
  elements, and emitted findings.
- Skip symbolic links during recursive discovery.
- Read only caller-selected paths.
- Write only to an explicit report path and never overwrite an input SVG.
- Keep GitHub workflows read-only except for a separately approved release job.

## Controls

- The parser is purpose-built and non-evaluating.
- Discovery uses `lstat`; symbolic links are recorded and skipped. Audited files
  are then opened once with no-follow semantics, verified through the same
  handle, and read with a byte ceiling.
- XML bytes, nesting, elements, attributes, diagnostics, metadata excerpts, and
  findings have explicit ceilings.
- Discovery separately bounds explicit inputs, matched files, visited entries,
  directories, and traversal depth.
- Layout analysis caches inherited state, transforms, and container lookup so
  ordinary and adversarial tree shapes remain linear in parsed elements.
- Human-readable output neutralizes terminal, newline, C1, and bidirectional
  display controls; JSON is serialized structurally.
- Report output rejects existing symlink components and uses a securely created
  same-directory temporary file followed by atomic replacement.

## Residual risks

- XML parsing is intentionally incomplete; unusual legal XML may be reported
  as invalid.
- Large permitted batches can still consume meaningful CPU and memory.
- Portable Node.js APIs cannot pin every intermediate directory component with
  `openat`; a hostile actor able to swap parent directories concurrently can
  still create filesystem races. Run shared-tree audits in an OS sandbox.
- Atomic report replacement protects final-component links, but an actively
  hostile shared parent directory remains outside the portable guarantee.
- A clean report does not make an SVG safe for every embedding context.
- Font estimates can produce false positives or miss browser-specific layout
  failures.

Use lower limits and an isolated worker when auditing uploads from untrusted
users. Do not grant that worker access to unrelated secrets or writable source
trees.
