# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
