# Provenance

## Ownership basis

SVG Semantic Layout Auditor was generalized from an internal Edilec Private
Limited quality-control script used to review SVG media produced for an
Edilec-owned editorial library. Edilec owns that source and this extraction.

## What was generalized

- lightweight XML structure and metadata checks;
- `viewBox` and dimension validation;
- SVG title and description inspection;
- static text-bound estimates;
- card/label containment heuristics; and
- deterministic finding summaries.

The public implementation was reorganized as an independent Node.js library
and CLI. It adds bounded file discovery, non-evaluating reference checks,
synthetic fixtures, a stable JSON schema, configurable failure thresholds, and
public maintenance documentation.

## What was deliberately excluded

- the Edilec article catalog and every article record;
- production SVGs, screenshots, media manifests, and audit reports;
- website routes, content IDs, taxonomy, and release configuration;
- fixed local Chrome paths, temporary browser profiles, and CDP automation;
- semantic comparison against Edilec article text;
- client, customer, collaborator, or personal information; and
- credentials, tokens, private URLs, internal topology, and deployment data.

All committed examples and test fixtures are synthetic and were created for
this repository. No third-party source code was copied into the implementation.

## Maintainer

Edilec Private Limited maintains the canonical repository. See
[MAINTAINERS.md](./MAINTAINERS.md) for the current public maintainer record.
