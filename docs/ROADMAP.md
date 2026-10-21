# Roadmap

The plan from here, ordered so that each phase makes the tool useful for a real
job before the next one starts. Everything rides on the same architecture: a new
target is a new adapter that produces a snapshot, plus checks that declare
`appliesTo` for it. Nothing about the scoring engine or existing checks changes.

## Where it is now

- Web target: a URL, rendered and measured in headless Chromium.
- Code target: a local path, walked and inspected.
- Deterministic grade plus an optional, separate, local LLM review.

## Phase 1 - Harden what exists (next)

Trust before breadth. Nothing new is worth adding if the existing checks are
wrong.

- Fixture tests for every check: a positive and a negative case each, wired into
  `npm test`. The `fixtures/sloppy.html` page becomes an automated assertion that
  the expected findings fire and a clean page produces none.
- Screenshot pixel sampling behind text, to replace the `scrim-missing` proxy
  with a real contrast ratio over images and gradients.
- `file://` support for local HTML.
- `performance` checks: Core Web Vitals via the Playwright trace, bundle-size
  budget, render-blocking resources.
- Dependency vulnerability data via OSV / `npm audit --json` / `pip-audit`,
  surfaced as `dependencies.vulnerable`.
- Normalize penalties by page size, so a one-section page is not scored like a
  twenty-section one.

### Done

- **Authenticated pages.** `slopaudit login` saves a Playwright storage state and
  `--storage-state` replays it, so pages behind a login can be audited. See
  [USAGE.md](./USAGE.md).
- **`.gitignore`-aware code scanning.** The code collector now uses git to skip
  ignored files, so it never scans a repo's own credential stores or build
  output.
- **Server-side vulnerability checks.** 12 native checks (command/SQL injection,
  deserialization, TLS, JWT, CORS, Dockerfile, IaC, …) plus hidden-overflow
  detection. See [GUARDRAILS.md](./GUARDRAILS.md).
- **Free analyzer orchestration.** `--scan` runs npm audit, Semgrep,
  OSV-Scanner, Trivy, gitleaks, checkov, bandit and pip-audit when installed,
  merging their findings into one report and score.
- **Imagery checks and `--deep` security probe.** Placeholder/stock/broken
  images; exposed files, user enumeration, secrets in JS bundles.
- **Printable reports.** `--format pdf` renders the full report with screenshots.

## Phase 2 - Multi-page web

Audit the pages that matter, not just the one you passed in.

- `--routes` and a shallow `--crawl` with a concurrency limit and `robots.txt`
  respect.
- Per-route grades rolled up into a site grade, with the worst route surfaced.
- A comparison mode: two JSON reports in, a score trend and a resolved/new
  findings diff out. This is what makes the tool useful for grading work over
  time rather than one snapshot.

## Phase 3 - Desktop and native applications

The same idea applied to installed apps. Reference the platform's own design
system: Fluent 2 on Windows, Apple HIG on macOS, GNOME HIG on Linux.

**Status:** the static `.NET/XAML` desktop adapter and the C/C++/Qt/DX/Vulkan
native adapter are shipped (11 and 23 checks). `--smoke` launches a Windows
native binary and verifies resize survival. The accessibility-tree/pixel
harness below is still planned.

### What a desktop adapter can collect

- **Accessibility tree and geometry** via the platform API: UI Automation on
  Windows, the AX API on macOS, AT-SPI on Linux. This gives the control tree,
  roles, names, labels, and bounding boxes, the equivalent of the DOM.
- **Rendered pixels** via screenshots, for color, contrast (sampling real
  background), and layout rhythm.
- **Icon and asset files** on disk, for the icon-library and tell-icon checks.
- **Package contents** for the code and secret checks: an unpacked app bundle or
  installed directory has the source, manifests, and embedded resources.

### How the checks map

| Category | Desktop source | Reuse |
| --- | --- | --- |
| accessibility | UI Automation / AX / AT-SPI tree | New checks, same category |
| layout | Control geometry from the tree | Adapted |
| color | Pixel sampling of screenshots | Adapted |
| typography | Rendered glyph metrics from pixels or the tree | Adapted |
| content | Control labels and text from the tree | Adapted |
| components | Icon assets on disk | Reused logic |
| security | Embedded strings, config files, update config | New checks |
| code / dependencies | Bundled source and manifests | Reused |

### Deliverables

- `src/desktop/` adapter producing a `DesktopSnapshot`.
- `appliesTo: ["desktop"]` checks for the platform design-system violations
  (custom chrome where the OS has a standard control, non-native control sizes,
  missing keyboard accelerators).
- A `--launch` mode that starts the app and drives it, and a `--static` mode
  that only inspects the package.

## Phase 4 - Mobile applications

Android first (APKs are easier to obtain and inspect), then iOS.

### Android

- **Static**: unzip the APK, read `AndroidManifest.xml`, the resource bundles,
  strings, and any embedded keys. Run the secret, dependency, and content checks
  against these. This needs no device.
- **Dynamic**: install on an emulator, screenshot, and read the view hierarchy
  via `uiautomator`, giving geometry, text, and content descriptions for the
  layout, color, typography, accessibility and content checks.
- Reference Material 3 for design-convention checks: touch targets at 48dp,
  standard navigation patterns, and so on.

### iOS

- **Static**: inspect the `.ipa` for `Info.plist`, bundled assets, and strings.
- **Dynamic**: simulator screenshots and the accessibility tree via XCUITest.
- Reference Apple HIG: 44pt touch targets, standard navigation and control
  conventions.

### Deliverables

- `src/mobile/` adapter with `android` and `ios` modes, or two adapters if the
  snapshots diverge enough to justify it.
- Platform-convention checks for Material 3 and HIG.

## Phase 5 - Ecosystem

Only after the detectors are trustworthy.

- **SARIF reporter** so findings show inline in code review tooling. (Not a
  GitHub Action; a format, usable anywhere.)
- **JUnit reporter** for test runners.
- **A diff viewer** and a small static site that hosts and compares reports.
- **A check plugin format** so third parties can ship checks without forking,
  loaded from config.
- **A published JSON schema** and a stable versioned report format, so other
  tools can consume reports without guessing.
- **npm publish** as the distribution path.

## Phase 6 - Context-aware suggestions

Today every finding ships with a rule-level fix template. This phase upgrades
those into **context-aware suggestions** that reference the real elements, files
and values a specific run found, and can be turned into a patch. Full design in
[SUGGESTIONS.md](./SUGGESTIONS.md).

Ordered by risk, safest first:

1. **Deterministic contextual suggestions.** Interpolate the finding's own
   evidence into a concrete sentence ("change `.muted-caption` from `#898b92` to
   at least `#5f6167`"). No model, no new failure mode, most of the value.
2. **Model tier, opt-in.** `--suggest --model <name>` for the cases a template
   cannot express, with a strict "cite a real target or the suggestion is
   dropped" rule, labeled as model-authored, and never affecting the score.
3. **Patches.** Show a unified diff first (print only), then `--apply` writing to
   a new git branch for a human to review. Auto-committing or pushing stays out
   of scope.

## Deliberately not planned

- **An LLM in the scoring path.** It stays a separate, labeled second opinion.
  The grade is deterministic or it is worthless.
- **Auto-fixing.** The tool reports; it does not rewrite someone's site. A future
  `--apply` (see [SUGGESTIONS.md](./SUGGESTIONS.md)) writes a diff to a branch for
  a human to review, but the tool never commits, pushes, or silently rewrites.
- **Any workflow file that runs on a hosted CI provider.** Automation is
  supported through the CLI and exit codes only, and wired up by whoever wants
  it, wherever they want it.
