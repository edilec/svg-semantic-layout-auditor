# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- `basis` on every finding (`static` or `estimated`) and `summary.byBasis`
  counts, so consumers can separate exact document facts from the text-layout
  heuristic without parsing message prose;
- an `[estimated]` marker and an explanatory line in the text report;
- `DECORATIVE_WITH_ACCESSIBLE_NAME`, reporting an SVG that is hidden from
  assistive technology while still supplying `aria-label`, `aria-labelledby`,
  or a non-empty `<title>`;
- the exported `ESTIMATED_FINDING_CODES` list and `withBasis` helper.

### Fixed

- findings and the `byCode` summary are ordered by UTF-16 code unit rather than
  by locale. Rule codes mix uppercase letters with underscores, and collation
  treats punctuation differently from raw code points, so the same document
  could produce differently ordered findings on two machines with different ICU
  data. The checked-in example report is unaffected.

### Changed

- `formatTextReport` tolerates a report saved before `byBasis` existed.

## 0.1.0 - 2026-08-25

### Added

- dependency-free CLI and library for static SVG audits;
- bounded, non-evaluating XML structure parser;
- accessibility, canvas, ID, reference, and active-content rules;
- conservative transformed text-bound and card-containment heuristics;
- deterministic text and JSON reports with configurable failure thresholds;
- synthetic examples and automated tests; and
- CI, CodeQL, dependency review, release verification, and community files.

### Security

- no-follow, bounded reads for regular input files;
- symlink-aware atomic report output;
- linear source locations, iterative traversals, and bounded entity decoding;
- independent depth, attribute, diagnostic, discovery, and finding ceilings; and
- effective `xml:base`, URL-control, and terminal-control detection.
