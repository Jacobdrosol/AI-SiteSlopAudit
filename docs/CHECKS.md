# Checks

Every check is deterministic: it measures the rendered page or the files on disk
and reports findings with evidence. `slopaudit checks` prints this list from the
live registry. This document adds what each one actually measures and where it
can be wrong.

Confidence below 1.0 means the check is heuristic and can produce false
positives; those findings say so in their evidence.

---

## Layout

### `layout.hero-signature` - high
The single most recognizable generated landing page. Fires only when all three
appear together on one page: exactly one `h1`, two or more pill-sized controls
(a link or button between about 0 and 260px wide and 56px tall or less), and a
section whose children are all card-styled and number three or four. The pill
controls must be in the hero - near the top of the page and not inside
`<header>`/`<nav>`/`<footer>` - and the card grid must be an early section.
Without those two constraints every page with a nav and a three-card block
fires, which is not the shape this check exists to catch.

### `layout.equal-card-grid` - medium
A section where every visible child is card-styled (radius, shadow, or border)
and they are all the same weight, with four or more of them. One per section,
capped at three findings.

### `layout.no-max-width` - medium
Body paragraphs and list items over 160 characters that render wider than 900px.
At 16px that is well past a comfortable measure.

### `layout.uniform-padding` - low, confidence 0.6
Compares the heights of major sections and flags the page when they barely vary
(coefficient of variation under 0.4). Sections that are all the same height leave
no rhythm. Heuristic; a genuinely uniform product page can trip it.

### `layout.motif-stacking` - medium / high
The "gut feeling that a site looks generated", made countable. A single
decorative device (an eyebrow badge above a heading, a tinted icon tile, a
"STEP 2" label, a row of chips, an icon beside a heading, a two-tone heading) is
a normal choice. The tell is repetition: the same handful of devices stamped
through every section, so the page reads as a template rather than a designed
page.

Fires when four or more kinds of motif appear eight or more times, escalating to
high at five kinds or twenty-four instances. Also fires on six or more eyebrow
labels, or two or more chip rows, on their own. It measures the real DOM and
deliberately ignores anything interactive, so buttons and nav links are not
counted as decoration.

This check cleanly separates sites: a page with no repeated decoration (most
production sites) does not fire; a page that puts a badge, a tile and a stepper
on every block does.

---

## Typography

### `type.default-font` - medium
Looks at body text over 20 characters and flags the page when 60% or more of it
resolves to a reflex stack (Inter, Roboto, system-ui, -apple-system, Segoe UI,
Arial, Helvetica). Inter is not wrong; reaching for it without deciding is the
tell.

### `type.too-many-sizes` - medium, high above 10
Counts distinct rendered font sizes on the page. More than six is not a scale.
More than ten is high.

### `type.mixed-sizes-in-block` - high
Consecutive sibling paragraphs under the same parent that render at different
font sizes (spread of 1px or more). This is the "looks broken, not styled" fault.
It compares real computed sizes and only groups paragraphs that are actually
adjacent, so a lede above unrelated body copy elsewhere does not trigger it.

### `type.line-height` - low
Body paragraphs over 80 characters whose line-height ratio falls outside
1.4-1.9.

### `type.gradient-text` - medium
Any element painting text with a gradient `background-clip`.

---

## Color

### `color.purple-blue-gradient` - high
A gradient containing both a purple/indigo/violet stop and a blue/sky stop. This
specific ramp is on the ban list.

### `color.contrast` - high / medium
Computes the real WCAG contrast ratio for each text node against its
**effective** background (the tool walks ancestors and composites translucent
layers). Thresholds are 4.5:1 body and 3:1 large text (24px, or 18.66px bold).
Text sitting over an image or gradient is skipped here and handled by the scrim
check, because its true background is unknown. Clipped / screen-reader-only text
(Tailwind `.sr-only` and the like) is skipped too: it is real text but never
painted, so its color is not a contrast defect. Confidence 0.85.

### `color.non-token` - low, medium when many
Colors in computed styles that match no CSS custom property value, occurring two
or more times, at least three distinct ones. This is how a palette accumulates
near-identical grays.

### `color.raw-accent` - low
Background fills at over 95% saturation and high brightness, the default
"pure red/green/blue" look.

### `color.scrim-missing` - medium, confidence 0.5
Near-white text present on a page that also has images, with no gradient overlay
detected. Only meaningful if the text actually sits over the image, which a
static snapshot cannot always prove, hence the low confidence.

---

## Content

### `content.emoji` - medium
Emoji anywhere in visible copy or the page title. Banned.

### `content.lorem-placeholder` - high / medium
Lorem ipsum in rendered copy (high) or obvious placeholder markers such as
"TODO", "coming soon", "your company here" (medium).

### `content.ai-voice` - high
Matches the banned marketing phrasings: "Elevate your", "Seamlessly integrate",
"Unlock the power of", "In today's fast-paced world", "It's not just X, it's Y",
"Whether you're a X or a Y", "...to the next level", "game-changing",
"cutting-edge", "state-of-the-art", "empower your", "the future of X is here",
"designed with you in mind", "tailored solutions". Reports all that match.

### `content.invented-proof` - medium, confidence 0.5
Testimonial-style quotes or star ratings with no verifiable attribution.
Deliberately cautious, since real proof can look like this.

### `content.generic` - low
A page over 400 characters that is dense with vague business nouns (solutions,
platform, leverage, scalable, world-class, next-generation, and similar), three
or more per 500 characters.

### `content.empty-body` - medium
A page with sections but under 400 characters of visible text. Structure with no
content.

---

## Components

### `components.tell-icons` - medium / low
Glyphs so overused in generated UI they read as placeholders: sparkles/wand
(medium), trending-up/down, user-round, calendar, sliders/settings, shield
(low). Matches against class names and detected icon source.

### `components.mixed-icon-libraries` - medium
More than one recognized icon library in use on a page (Lucide, Font Awesome,
Heroicons, Phosphor, Radix, Material Symbols).

### `components.glassmorphism` - medium / low
Any element with a `backdrop-filter`. On the ban list unless the reference uses
it.

### `components.load-animation` - low, confidence 0.6
Elements with a running CSS animation. Flags that motion exists; a human decides
whether it is functional.

### `components.generic-alt` - medium
Images with no alt attribute, a filename as alt, or generic filler like "image",
"hero", "banner". Decorative and tiny images are skipped.

### `components.placeholder-image` - high / medium
Broken images (natural size 0), inline SVG lazy-load placeholders, and images
served from a placeholder service (`placehold.co`, `via.placeholder`,
`dummyimage`). This is what catches client-logo grids that render as empty boxes.
The page is scrolled end to end and images are awaited before measuring, so a
lazy-loaded image that had simply not requested yet is not reported as broken.

### `components.stock-photo` - low / medium
Images loaded from a known stock library: Pexels, Unsplash, Shutterstock, Getty,
Adobe Stock, iStock, Freepik, Envato, and others. Generic stock photography is
the visual equivalent of filler copy and needs a license. Low severity: it is
only a tell when it replaces a real product or team photo.

### `components.image-upscaled` - low
Images displayed wider than their real pixel width (blurry), or stretched off
their natural aspect ratio (distorted). Needs at least two instances. A display
aspect that differs because of `object-fit: cover`/`contain` is an intentional
crop or letterbox, not distortion, and is not counted.

### The vision-model tier (not yet built)
Whether a photograph *looks* AI-generated or generic is a perception judgment
with no ground truth in the DOM. It is designed as an opt-in, separately-graded
model pass (`--vision --model qwen2.5vl:3b`) that never affects this score. See
[IMAGERY-AND-SECURITY.md](./IMAGERY-AND-SECURITY.md).

---

## Responsive

### `responsive.horizontal-overflow` - high / medium
Content wider than the viewport at a tested width. Also detects content that is
wider than the viewport but hidden by `overflow-x: hidden`, in which case the
excess is **clipped and unreachable**, not scrollable. High above 40px. Tested at
1440, 768 and 375 by default.

### `responsive.body-font-too-small` - medium
Body font under 16px at any tested viewport.

### `responsive.touch-targets` - medium
Controls smaller than 44x44px, measured in the narrowest tested viewport (the
mobile layout) rather than the desktop one, so desktop-only nav links are not
judged by a phone threshold they never face. Skips text-less links with no label
(caught by the accessibility check) and links embedded in flowing text (WCAG
2.5.5 exempts those). Requires at least three offenders.

### `responsive.viewport-meta` - medium
No viewport meta tag, or a tag that sets `user-scalable=no` or
`maximum-scale=1`, which blocks pinch-zoom.

---

## Accessibility

### `a11y.lang` - medium
No `lang` on the html element.

### `a11y.heading-order` - medium / low
No `h1` on the page (medium), or a heading level that skips (h2 to h4) (low).

### `a11y.unlabeled-controls` - high
Buttons, links, selects and textareas with no accessible name: no text and no
`aria-label`. Icon-only controls without a label vanish for screen-reader users.

### `a11y.document` - medium / low
Missing page title (medium) or meta description (low).

### `a11y.focus-visible` - medium
Fires only when no interactive element and no stylesheet rule provides a visible
focus style. It scans the document's style rules (including inside `@media`,
`@layer` and `@supports`) for a `:focus`/`:focus-visible` selector that sets an
outline or box-shadow, and also probes each control's own outline. A global
`*:focus-visible { outline: … }` is therefore correctly seen as present, instead
of the check firing on every site that styles focus on interaction.

---

## Security (web)

### `security.insecure-form` - critical / medium
A form containing a password field that posts over plain http (critical), or a
password form posting to an unexpected external host (medium).

### `security.secret-in-js` - critical (deep only)
A secret pattern found inside the *contents* of a same-origin JavaScript bundle.
The passive check only sees URLs; `--deep` fetches bundles (capped) and scans
them, which is where hardcoded keys actually live.

### `security.exposed-file` - critical / high (deep only)
A sensitive path returns 200 with matching content: `/.env`, `/.git/HEAD`,
backups, SQL dumps, `phpinfo.php`, API schemas, and more. A soft-404 does not
trip it because the body must match the file's signature.

### `security.user-enumeration` - medium (deep only)
The WordPress REST API `/wp-json/wp/v2/users` lists author usernames.

### `security.secrets-in-bundle` - critical, confidence 0.6
High-signal secret patterns in page sources or script URLs: Stripe live keys,
AWS key ids, GitHub tokens, Google API keys, Slack tokens. Client code is public.
The matched value is not printed; only the pattern that matched.

### `security.csp-weak` - medium / low
A CSP header is present but contains `unsafe-inline`, `unsafe-eval`, or a
wildcard source, so it barely mitigates XSS.

### `security.sri` - low
Cross-origin scripts or stylesheets loaded without a Subresource Integrity hash,
so a compromised CDN runs arbitrary code.

### `security.policy-headers` - low
No `Referrer-Policy` or `Permissions-Policy`, so referrer data leaks and powerful
browser APIs are available to any embedded script.

### `security.third-party-scripts` - low / medium
Five or more distinct external origins load executable script. Each is another
company whose compromise becomes your compromise.

### `security.csp` - medium, high with inline script
No `Content-Security-Policy` header. High when the page also runs inline script,
because that combination is where XSS lands.

### `security.mixed-content` - high
An https page loading scripts or stylesheets over plain http.

### `security.hsts` - medium
No `Strict-Transport-Security` on an https response.

### `security.cookies` - medium / low
`Set-Cookie` missing `Secure`, `HttpOnly`, or `SameSite`. Missing Secure is
medium.

### `security.clickjacking` - low
Neither `X-Frame-Options` nor a CSP `frame-ancestors` directive.

### `security.nosniff` - low
`X-Content-Type-Options` absent or not `nosniff`.

### `security.version-disclosure` - low
`Server`, `X-Powered-By`, `X-AspNet-Version` or `X-Generator` exposing a version.

---

## Code

### `security.hardcoded-secrets` - critical / high
Pattern scan of source for AWS keys, Stripe keys, GitHub tokens, Slack tokens,
Google API keys, npm tokens, OpenAI keys, private key blocks, JWTs, and generic
`secret = "..."` assignments. Values that look like placeholders or env reads
are skipped. Matched secrets are **redacted** in the report (`sk_l...redacted...`),
never echoed in full.

### `security.env-committed` - high / critical
A `.env` file present with no `.gitignore` (high), or secret-like files tracked
by git (critical). Critical, because tracked secrets are already in history.

### `code.project-hygiene` - medium / low / info
No README (medium), no tests (medium), not a git repository (low), no license
(info). Detects a parent-directory git repo.

### `code.placeholder-content` - medium
Lorem ipsum or placeholder strings committed in source. Filters out comments,
regex literals, and rule metadata so a tool that detects placeholder text is not
flagged for containing the word.

### `code.todo-markers` - low / medium
TODO/FIXME/HACK/XXX/BUG comments. Three or more, and denser than one per 1000
lines is medium.

### `code.commented-out-code` - low
Six or more consecutive lines of commented-out code (lines starting with a
comment marker followed by code keywords).

### `code.large-files` - low / medium
Source files over 800 lines.

### `code.duplication` - low / medium, confidence 0.6
The same 12-plus-line block of non-comment code appearing in two or more files.
Sliding window over source files; heuristic.

---

## Server-side and backend security (native, code target)

Pattern heuristics over source; high recall, confidence-scored. They skip
comments, rule metadata, and pattern-definition lines. Deeper analysis comes from
the `--scan` analyzers (see [GUARDRAILS.md](./GUARDRAILS.md)).

### `security.command-injection` - critical, confidence 0.65
A shell/exec call (exec, execSync, os.system, subprocess, shell=True) built from
variables, concatenation or interpolation.

### `security.sql-injection` - critical, confidence 0.6
A SQL statement built by concatenation or interpolation rather than parameters.

### `security.insecure-deserialization` - critical, confidence 0.75
pickle.load, yaml.load without SafeLoader, marshal, or ObjectInputStream.

### `security.code-execution` - high, confidence 0.7
eval, new Function, dangerouslySetInnerHTML, or innerHTML assignment.

### `security.debug-enabled` - high
Debug/development mode left on in a server config or app entrypoint.

### `security.tls-verify-disabled` - high, confidence 0.85
rejectUnauthorized: false, NODE_TLS_REJECT_UNAUTHORIZED=0, InsecureSkipVerify.

### `security.jwt-weak` - high, confidence 0.8
JWT verification disabled or the "none" algorithm accepted.

### `security.permissive-cors` - medium, confidence 0.7
Wildcard CORS origin, which with credentials lets any site act as the user.

### `security.weak-crypto` - medium, confidence 0.7
MD5/SHA1/DES/ECB used in code.

### `security.insecure-random` - medium, confidence 0.55
Math.random / random used next to a token, session, OTP or key.

### `security.dockerfile` - high / medium, confidence 0.8
Container runs as root, floating base tag, secret baked into ENV, world-writable.

### `security.iac-public` - high, confidence 0.6
Public-read ACLs, 0.0.0.0/0 ingress, or wildcard principals in IaC.

## External analyzers (`--scan`, not checks)

Run on code targets when installed, normalized into the same findings:
`sca.npm-audit`, `sast.semgrep`, `sca.osv`, `sca.trivy`, `secrets.gitleaks`,
`iac.checkov`, `sast.bandit`, `sca.pip-audit`. See
[GUARDRAILS.md](./GUARDRAILS.md).

---

## Dependencies

### `dependencies.no-lockfile` - medium
A manifest with dependencies but no lockfile.

### `dependencies.unpinned` - low / medium
Floating version ranges (^, ~, *, latest) in a manifest **with no lockfile**, so
the resolved graph is not fixed. Skipped entirely when a lockfile exists.

### `dependencies.count` - low / medium
More than 60 npm production dependencies. Medium above 120.

### `dependencies.manifest-only` - medium
Dependencies declared but fewer than three non-test source files and at least
five dependencies. A scaffold that was never filled in.

---

## Desktop (XAML, `desktop` target)

Static checks for .NET/XAML desktop apps (Avalonia, WinUI, WPF, MAUI). The target
is `audit <path> --type desktop`, or auto-detected when a directory has a .NET
project file and `.axaml`/`.xaml` views.

### `desktop.dead-control` - high
A `Button`, `RepeatButton`, `HyperlinkButton` or leaf `MenuItem` with no
`Command`, `Click`, `NavigateUri` or dialog role. A control that does nothing is
worse than no control. Confidence 0.85.

### `desktop.unlabeled-control` - medium
A self-closing button with no `Content`, `AutomationProperties.Name` or
`ToolTip.Tip`, so assistive tech announces only "button".

### `desktop.ui-thread-blocking` - high
`.Result`, `.Wait()`, `GetAwaiter().GetResult()` and `Thread.Sleep` in C#. These
freeze the window while they run; await asynchronously instead.

### `desktop.missing-pointer-cursor` - medium
No view sets a pointer cursor on buttons, list items or inputs, so pressable
controls keep the arrow cursor and feel dead. One global style fixes all of them.

### `desktop.chart-no-axis` - medium
A chart control renders marks but never draws text, so it has bars with no
scale. A chart needs both axes labelled.

### `desktop.placeholder-content` - medium
Lorem ipsum, "coming soon", TBD and similar filler in a view.

### `desktop.fixed-size` - medium
A container with both width and height fixed, or a window with `CanResize="False"`,
which clips at other sizes. Windows with Min/Max constraints are not flagged.

### `desktop.no-virtualization` - low
An `ItemsControl` bound to a collection without virtualization. Fine for a short
fixed list; a stall risk if it grows. Confidence 0.5.

### `desktop.hardcoded-color` - low
Hex or named colours set directly on a view instead of a theme resource.

### `desktop.hardcoded-font` - low
A literal `FontFamily` on a view instead of a type token.

### `desktop.oversized-view` - low
A XAML view over 400 lines, hard to review and prone to duplicated styling.

### Runtime checks (planned, not built)
Rendering at multiple window sizes to catch clipped text/controls, hit targets,
contrast, and frame-time under resize need a headless Avalonia/UIA harness; the
current desktop target is static only.

---

## Native (C/C++/Qt/Direct3D/Vulkan, `native` target)

Static checks for native applications and engines. The target is
`audit <path> --type native`, or auto-detected when a directory has a
`CMakeLists.txt`, Qt `.pro`, `.vcxproj`, `.uproject`, `meson.build`,
`xmake.lua` or `premake5.lua` plus C/C++ sources. With `--smoke <exe>`, the
auditor also launches the built binary, resizes it through four sizes, and
checks that it stays alive and responding.

These checks are heuristics with named confidence. They are aimed at the
failure modes that survive a successful compile: unchecked graphics results,
a missing resize path, device loss, detached threads and blocking the UI
thread.

### `native.unchecked-api-result` - high
A Direct3D `HRESULT` or Vulkan `VkResult` call whose result is not tested on
the line or the next two lines. Device creation, swapchain creation and
allocation failures are then used as if they succeeded. Only runs on projects
detected as Direct3D or Vulkan. Confidence 0.75.

### `native.resize-path-missing` - high
A graphics surface with no resize path. Direct3D: a swapchain with no
`ResizeBuffers` (and, under Win32, no `WM_SIZE`). Vulkan: a swapchain with no
`VK_ERROR_OUT_OF_DATE_KHR`/`VK_SUBOPTIMAL_KHR` handling, no
`vkDeviceWaitIdle`/`vkQueueWaitIdle`, or no `vkDestroySwapchainKHR`. Also flags
a Qt OpenGL widget without `resizeGL`, and a resizable SDL window with no
resize event handler. This is the "opens fine, crashes when you drag the edge"
class of bug.

### `native.device-loss-unhandled` - medium
Direct3D 12 without `GetDeviceRemovedReason`/`DXGI_ERROR_DEVICE_REMOVED`, or
Vulkan without `VK_ERROR_DEVICE_LOST`. A driver reset or GPU hang becomes an
unexplained crash.

### `native.unsafe-c-function` - high
`strcpy`, `strcat`, `sprintf`, `vsprintf`, `gets` or `alloca`. These write
without knowing the destination size.

### `native.command-exec` - high
`system()`, `popen()`, `WinExec()` or `std::system()`. A shell string built
from any variable is command injection. `QProcess` and `CreateProcess` are not
flagged because they take an explicit program and argument list.

### `native.secret-literal` - high
A credential-like literal: an assignment to `api_key`/`secret`/`token`/
`password`, an AWS access key, a private-key header, or an `sk-` token.
Placeholder-looking values are skipped. Confidence 0.7.

### `native.thread-detach` - medium
`.detach()` or `pthread_detach()`. A detached thread can outlive the state it
captured, and nothing can join it during teardown.

### `native.blocking-ui` - high
`QThread::sleep`/`msleep`/`usleep`, `sleep_for`, `Sleep`, `waitForFinished`, or
`QApplication::processEvents` inside a loop, in a UI-ish source file. Only
files that look like windows/widgets/app entry points are checked, so a worker
that sleeps is not flagged.

### `native.delete-this` - medium
`delete this;`. Any caller or signal connection still holding the object has a
dangling pointer.

### `native.fixed-window` - medium
`this->setFixedSize(...)`, `Qt::MSWindowsFixedSizeDialogHint`, a `.ui` file
whose minimum and maximum size are equal, a QML window whose minimum and
maximum width are equal, or a Win32 window style with a caption but no
`WS_THICKFRAME`/`WS_SIZEBOX`. Fixed child sizes are not flagged.

### `native.qt-missing-cursor` - medium
A Qt app with buttons, item views, tabs, sliders or a QML `Button`/`MouseArea`
but no `PointingHandCursor` and no `cursor: pointer`.

### `native.qt-chart-no-axis` - medium
A custom-painted chart (file name or path contains chart/graph/plot, uses
`paintEvent`/`paintGL`/`QPainter` and a drawing call) with no
`drawText`/`QFontMetrics`. Confidence 0.6.

### `native.placeholder-content` - medium
Lorem ipsum, "coming soon", TBD, "your text here" and similar filler in a
string literal. A legitimate `setPlaceholderText("Search")` is not matched.

### `native.hardcoded-color` - low
Five or more distinct hex colours in one C++ file outside a theme/palette/
stylesheet, or a `setStyleSheet` call containing a literal colour. A few
colours in a custom-painted icon are not flagged.

### `native.hardcoded-absolute-path` - medium
A string with `C:\Users\...`, `/home/...` or `/Users/...`. It works on the
author's machine and fails everywhere else.

### `native.todo-markers` - low
`TODO`, `FIXME`, `HACK` or `XXX` in a source comment.

### `native.oversized-file` - low
A C/C++ source file over 800 lines. Large native files hide ownership bugs.

### `native.no-tests` - medium
600 or more lines of non-test C/C++ with no test source and no `add_test`/
`enable_testing`. A build only proves it compiles.

### `native.no-sanitizers` - low
A CMake/MSBuild project with no ASan/UBSan option. Memory bugs and UB then
ship silently.

### `native.weak-warnings` - low
The build does not enable `/W4` (MSVC) or `-Wall -Wextra` (Clang/GCC).

### `native.no-cxx-standard` - low
The build does not pin a C++ standard (`CXX_STANDARD`, `cxx_std_XX`,
`/std:` or `<LanguageStandard>`).

### `native.vulkan-no-validation` - low
A Vulkan app with no `VK_LAYER_KHRONOS_validation` or `VK_EXT_debug_utils`.

### `native.qt-native-child-host` - medium
A Qt project that creates a raw Win32 window (`CreateWindowEx` with
`WS_CHILD`/`WS_POPUP`) or a foreign `QWindow` and also uses
`QMainWindow`/`QSplitter`/`QDockWidget` layouts. Qt does not manage the native
window's geometry, so after layout it can keep its pre-layout size, cover the
Inspector/Output, or force the central pane to the full window. This is the
exact pattern that made the Arcstone Qt shell lose panes. Prefer an offscreen
render target displayed by a normal Qt widget; if a foreign window is required,
assert every pane is visible with non-zero geometry after show and resize.
Confidence 0.75.

### Runtime smoke findings (`--smoke <exe>`)
These are emitted by the probe, not by the static registry:

- `native.runtime-crash` - critical: the process exited before a window
  appeared, with a crash code.
- `native.runtime-exit` - high: the process exited before a window appeared
  with a non-crash code.
- `native.runtime-no-window` - high: no top-level window appeared within the
  timeout.
- `native.runtime-resize-crash` - critical: the process died during a resize.
- `native.runtime-hang` - high: the window stopped responding during resize.
- `native.runtime-resize-failed` - medium: the window rejected a programmatic
  resize.

The probe is Windows-only today. On other platforms it reports that it was
skipped, and the static checks still run. It launches the executable it is
given, so only point it at a binary you built. It treats the first top-level
window as the app, so deploy the runtime before probing; a missing-DLL or
plugin error dialog can otherwise be mistaken for the main window.

---

## Not yet checked

The honest gaps, also in [IMPROVEMENTS.md](./IMPROVEMENTS.md): runtime
performance (Core Web Vitals), colour-only meaning, keyboard trap detection,
dark-mode correctness, i18n, real dependency vulnerability data (CVE lookup),
mobile app analysis, desktop runtime checks (resize clipping, hit targets, frame
timing), and font-file fingerprinting.
