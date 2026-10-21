# Imagery and deep security

Two capabilities that go beyond what a snapshot of computed CSS can measure.
Both follow the same rule: **deterministic first, model second, and the
deterministic score never depends on a model.**

## Imagery

### What is measured deterministically (shipped)

The web target now collects real image facts (natural vs displayed size, data
URIs, loading attribute) and runs these checks:

| Check | Detects |
| --- | --- |
| `components.placeholder-image` | Broken images (natural size 0), inline SVG lazy-load placeholders, and images served from a placeholder service (`placehold.co`, `via.placeholder`, `dummyimage`). |
| `components.stock-photo` | Images served from a known stock library (Pexels, Unsplash, Shutterstock, Getty, Adobe Stock, iStock, Freepik, Envato, …). |
| `components.image-upscaled` | Images shown larger than their real pixel width (blurry), or stretched off their natural aspect ratio (distorted). |
| `components.generic-alt` | Missing, filename, or generic alt text. |

These need no model and cannot hallucinate. They are what catches "8 client
logos are inline placeholder SVGs", "this 896px file is displayed at 619px and
soft", and "12 photos come from a stock service".

### What a model can add (future, opt-in)

The objective checks cannot tell whether a photograph *looks* synthetic or
generic, or whether the art direction is consistent. That is a perception
question, and it is exactly what a vision model is for. A local vision model is
already installed (`qwen2.5vl:3b`).

Proposed design:

- `slopaudit audit <url> --vision --model qwen2.5vl:3b`.
- After the deterministic report is final, send the rendered screenshot (and
  optionally a few individual images) to the local vision model and ask for a
  structured judgment: does this look like AI-generated or stock imagery, is the
  art direction consistent, are people/products depicted coherently.
- The result is a **separate, labeled section**, like the existing `--llm` review.
  It never changes the deterministic score, and it is off by default.
- The model sees the image and returns JSON; a malformed answer is a warning, not
  a failure.

Why not the deterministic path: "this photo looks AI-generated" is a judgment
with no ground truth in the DOM. Putting it in the score would make the score
non-deterministic, which defeats the point of the tool.

Cheap deterministic improvements that can come before the model tier: reading
C2PA / IPTC `Digital Source Type` metadata (some AI tools stamp images as
`trainedAlgorithmicMedia`), and reverse-image-search of the image URL for stock
sources when the asset is self-hosted rather than loaded from a known CDN.

## Deep security (`--deep`)

The default security checks read headers, cookies, and the page. `--deep` goes
further and makes **active requests** to the target:

- **Exposed files**: `/.env`, `/.git/HEAD`, `/.git/config`, `.svn`, `.DS_Store`,
  `wp-config.php.bak`, backup archives, SQL dumps, `phpinfo.php`,
  `server-status`, `swagger.json`, `openapi.json`. A hit requires a 200 response
  whose body matches the file's signature, so a soft-404 does not trip it.
- **User enumeration**: the WordPress REST API `/wp-json/wp/v2/users`, which
  lists author usernames for password attacks.
- **Secrets in JavaScript bundles**: it fetches same-origin bundles (capped) and
  scans their contents. The passive check only sees URLs; this sees the code,
  which is where hardcoded keys actually live.

Findings are `critical`/`high` and weighted to dominate the score, because an
exposed `.env` or a key in a bundle is the real thing.

**Authorization.** `--deep` is active testing. Run it only against targets you
own or are explicitly permitted to test. It is off by default for that reason.
Request volume is one GET per probe, no redirects followed, each on a timeout.

```bash
slopaudit audit https://your-site.example --deep
```

### What is still missing on the security side

- **CVE data**: known-vulnerable dependency and plugin versions (OSV,
  `npm audit`, `pip-audit`, WPScan for WordPress plugins/themes). This is the
  largest remaining gap and is tracked in [ROADMAP.md](./ROADMAP.md).
- **TLS configuration**: protocol and cipher strength, certificate chain,
  HSTS preload status.
- **Authenticated scanning** and state-changing tests are deliberately out of
  scope.
- **Client-side storage**: scanning localStorage/sessionStorage for tokens and
  PII after load.
