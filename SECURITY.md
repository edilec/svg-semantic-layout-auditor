# Security policy

## Supported versions

Security fixes are provided for the latest release line.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Email
[hello@edilec.com](mailto:hello@edilec.com) with:

- the affected version or commit;
- a minimal synthetic reproduction;
- the expected and observed behavior; and
- the security impact and required conditions.

Do not send credentials, customer data, unpublished SVG libraries, or
third-party personal information. Edilec will coordinate validation,
remediation, and disclosure with the reporter.

## Scope boundary

The tool statically inspects local files. It does not sanitize SVGs, render
them, fetch resources, or establish that a clean file is safe in every
embedding context. Read [docs/threat-model.md](./docs/threat-model.md) before
using the auditor on untrusted uploads.

The core applies explicit parser and report ceilings, opens inputs without
following final-component symbolic links, and writes reports with atomic
replacement. Portable Node.js APIs cannot fully pin every intermediate path
component, so concurrently mutable shared directories should be audited inside
an OS-level sandbox with no unrelated readable or writable files.
