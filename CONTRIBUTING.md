# Contributing

Thank you for helping improve SVG Semantic Layout Auditor.

## Before opening a change

- Use a public issue for bugs, feature proposals, and false positives.
- Use the private route in [SECURITY.md](./SECURITY.md) for vulnerabilities.
- Use only synthetic SVG fixtures that you created or have permission to
  publish.
- Do not include production artwork, customer media, credentials, personal
  data, proprietary fonts, or inaccessible external test services.

## Development

Use Node.js 20 or newer.

```sh
npm test
npm run test:coverage
npm run check
```

Every rule change should include:

1. a minimal fixture or inline SVG that demonstrates the issue;
2. a negative test that prevents overbroad matching;
3. a clear finding code and actionable message;
4. an update to `docs/rules.md`; and
5. an explanation of important false positives or unsupported cases.

Keep changes small and reviewable. Do not add a runtime dependency when a
bounded standard-library implementation is practical.

## Pull requests

Pull requests should explain the problem, the chosen boundary, verification,
and any security or compatibility impact. Maintainers may request a smaller
fixture when a submitted SVG contains unrelated artwork.

By contributing, you agree that your contribution is licensed under the MIT
License and that you have the right to submit it.
