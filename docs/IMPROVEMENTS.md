# Known improvements

This is the honest weaknesses list. The tool's value is being trustworthy, so it
is better to state where it is wrong than to hide it. Each item is a real
limitation of the current code.

## Detection accuracy

### Native checks are heuristics, not a compiler
The native target reads source text: it can see an unchecked `VkResult`, a
missing `ResizeBuffers`, a detached thread or a literal credential, but it
cannot prove ownership or evaluate a template. Use `--scan` to add cppcheck and
clang-tidy, and use `--smoke <exe>` for the runtime path. Static findings below
the high band are deliberately confidence-weighted.

### The code target uses text heuristics, not an AST
`code.duplication`, `code.commented-out-code` and `code.large-files` read source
as lines and strings. They do not parse. Duplication uses a sliding window over
trimmed lines, so reformatted copies are missed and coincidental matches can
occur. Confidence is set to 0.6, but a real parser (tree-sitter or per-language
parsers) would make these reliable. This is the single biggest accuracy gap.

### Contrast over images and gradients is skipped
`color.contrast` cannot know the pixel behind text over an image or a gradient,
so it skips those nodes and leans on `color.scrim-missing`, which is a proxy with
confidence 0.5. Sampling the actual screenshot behind each text node would give
a true ratio. Playwright screenshots are already captured for this purpose but
are not yet analyzed.

### Focus styles defined outside CSS can be missed
`a11y.focus-visible` now scans the document's style rules for a `:focus` /
`:focus-visible` selector that sets an outline or box-shadow, which covers the
common cases (a global rule, Tailwind focus utilities). It can still miss a focus
indicator applied solely from JavaScript (an inline style set on focus) or from a
cross-origin stylesheet the scan cannot read. Driving real focus through the page
with the keyboard and re-measuring the outline would close that. The check no
longer fires on every site that styles focus on interaction.

### Animation is flagged, not judged
`components.load-animation` reports that animations exist. It does not know
whether they respect `prefers-reduced-motion` or whether they are decorative. It
should check the reduced-motion media query and only flag on-load flourish.

### No performance measurement
There are no Core Web Vitals, no bundle-size budget, and no render-blocking
resource check. The `performance` category exists in the type system and the
weights, but no checks populate it. Lighthouse or the Playwright trace API would
fill it.

### Color-only meaning is not detected
`color.color-only-meaning` was specified but not implemented, because reliably
distinguishing a status dot that conveys meaning from one that is decoration
needs more than computed styles. It needs the accessibility tree plus a
before/after comparison.

### Font detection is by stack name, not by file
`type.default-font` matches the `font-family` string against a known list. A
site serving Inter under a custom name, or self-hosting a licensed font, is not
recognized. Inspecting the loaded `@font-face` rules and font files would be
exact.

## Coverage gaps

### Coverage is uneven across target kinds
Web, code, desktop (.NET/XAML) and native (C/C++/Qt/DX/Vulkan) targets exist.
Mobile is still planned. The native target is stronger on lifecycle and
security patterns than on deep semantic analysis, and its runtime smoke probe
is Windows-only. See [ROADMAP.md](./ROADMAP.md).

### A single page per run
A web audit renders one URL. It does not crawl, so it misses slop on the pages
that matter (the pricing page, the docs, the dashboard). Multi-page and
multi-route runs are planned.

### Authenticated pages work, but only one session at a time
The web adapter can now log in (`slopaudit login`) and replay a saved session
with `--storage-state`, so pages behind auth are auditable. Limitations remain:
a run uses exactly one session, so auditing a student view and an admin view of
the same app takes two runs; there is no built-in multi-role support; and a SPA
whose login flow needs multi-step interaction (2FA, an SSO redirect) needs the
manual path where you log in yourself and export the storage state by hand.

### Local files need a server
A local `.html` file has no URL, so `file://` support is still missing. Serve it
over http as a workaround today.

### No dependency vulnerability data
`dependencies.*` checks manifests and lockfiles for hygiene, not for CVEs. It
does not know that a pinned version is known-vulnerable. `npm audit --json`,
`pip-audit`, and the OSV database would add real risk, and it belongs in a
`dependencies.vulnerable` check.

## Design and behavior

### Category scores can look harsh on small pages
A page with one section and three findings can drop a category a lot because the
denominator of "how much page there was" is ignored. Normalizing penalties by
content volume (findings per 1000 words or per section) would make small and
large pages comparable. The current behavior is at least consistent and
documented.

### `layout.uniform-padding` and `content.generic` are opinionated
They encode a point of view (rhythm matters, buzzwords are bad) that is correct
for this tool's purpose but can be wrong for a deliberately uniform dashboard.
They are low severity and confidence-scored for that reason, and either can be
disabled in config. Worth revisiting with real false-positive data.

### `security.version-disclosure` can be noisy
Some stacks set `X-Powered-By` and cannot easily remove it behind every proxy.
It is low severity; consider making it `info` by default.

### The HTML report is not yet a comparison
It shows one run. For grading work over time, a diff view (score trend, resolved
and new findings between two runs) is far more useful. The JSON reports are
complete enough to build it; the viewer does not exist yet.

### Fixes are rule-level templates, not per-element suggestions
Every finding ships a concrete `fix`, but it is written for the rule, not for
the specific markup. "Keep one decorative device" is not "cut the three icon
tiles in your `How it works` section at `src/components/HowItWorks.tsx:42`". The
rule-level fix is safe and deterministic; the per-element version needs to reason
about a specific element, which is where a model is most likely to be
confidently wrong. The design for upgrading to context-aware, and eventually
patch-producing, suggestions is in [SUGGESTIONS.md](./SUGGESTIONS.md). It is not
built yet.

## Robustness

### No rate limiting or politeness for web targets
Auditing many URLs against one host will hammer it. A polite crawl needs a
concurrency limit, delay, and respect for `robots.txt`.

### Viewport capture reloads are implicit
Viewport captures resize the existing page rather than reloading, so a layout
that only settles on a fresh load at that width could be measured mid-transition.
The 250ms settle helps; a per-viewport reload would be exact but slower.

### Snapshot size
The web snapshot includes every text node, color and geometry rect. Very large
pages produce large JSON. Streaming or sampling would matter at scale.

## Testing

### Checks are under-tested
There are tests for the scoring engine, color math, the reporter escaping, and a
few checks. There is no fixture-based test for most of the 109 checks. Each check
should have a positive fixture and a negative fixture. This is the highest-value
testing work.

### No end-to-end test against a known-bad page
The `fixtures/sloppy.html` page exists and is manually verified, but it is not
wired into an automated test that asserts the expected findings fire.
