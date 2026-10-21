# Guardrails: server, desktop, mobile, and vulnerability scanning

The goal is CodeRabbit-style coverage without paying for anything: catch slop
*and* vulnerabilities, locally, deterministically, and for free. The strategy
has three layers.

1. **Native checks** that need no installs (this is most of what the tool does).
2. **An orchestration layer** that runs best-in-class free security tools when
   they are installed and folds their findings into the same report and score.
3. **Target adapters** that extend the same model to desktop and mobile.

Nothing here calls a paid service, and nothing leaves the machine.

## 1. Server-side and backend code (shipped)

The code target now runs native vulnerability checks over source, with zero
external dependencies. They are pattern heuristics, so they are high-recall and
confidence-scored, but they catch the recognizable classes:

| Check | What it finds |
| --- | --- |
| `security.command-injection` | Shell/exec calls built from variables (critical) |
| `security.sql-injection` | SQL built by concatenation or interpolation (critical) |
| `security.insecure-deserialization` | pickle / yaml.load / ObjectInputStream (critical) |
| `security.code-execution` | eval, new Function, raw HTML injection |
| `security.debug-enabled` | Debug mode left on in a server config |
| `security.tls-verify-disabled` | Certificate verification turned off |
| `security.jwt-weak` | JWT verification disabled or "none" accepted |
| `security.permissive-cors` | Wildcard CORS, often with credentials |
| `security.weak-crypto` | MD5/SHA1/DES/ECB in code |
| `security.insecure-random` | Math.random for tokens/sessions/OTP |
| `security.dockerfile` | Root user, floating base tag, secrets in ENV, world-writable |
| `security.iac-public` | Public-read ACLs, 0.0.0.0/0 ingress, wildcard principals |

They skip comments, rule metadata, and pattern-definition lines, so a linter (or
this tool itself) is not flagged for *naming* a dangerous pattern.

## 2. Analyzer orchestration (`--scan`)

This is the "guardrails" engine. On a code target, `--scan` detects the project
and runs whichever of these free tools are installed, normalizing their output
into the same `Finding` model:

| Analyzer | Covers | Install |
| --- | --- | --- |
| `sca.npm-audit` | JS dependency CVEs | already have npm |
| `sast.semgrep` | SAST, 30+ languages | `pip install semgrep` |
| `sca.osv` | dependency CVEs, many ecosystems | OSV-Scanner binary |
| `sca.trivy` | vulns + misconfig + secrets | Trivy binary |
| `secrets.gitleaks` | secret scanning | gitleaks binary |
| `iac.checkov` | Terraform / Docker / k8s | `pip install checkov` |
| `sast.bandit` | Python SAST | `pip install bandit` |
| `sca.pip-audit` | Python dependency CVEs | `pip install pip-audit` |

```bash
slopaudit audit ./my-project --scan
slopaudit audit ./my-project --scan --disable-analyzer sca.trivy
```

Every analyzer degrades gracefully: if the tool is missing, it is skipped with a
note and the native checks still run. A single analyzer failing never fails the
audit. Findings from all sources merge into one report, one category breakdown,
and one score, so security findings weigh what they should.

Why not reimplement this: Semgrep, Trivy and gitleaks are the actual tools the
industry uses; orchestrating them is both more accurate and far less work than
writing a worse version. This tool's contribution is the merge and the slop
layer on top.

## 3. Desktop and native applications

Two adapters share the same `Target` → snapshot → checks → score architecture.

- **Desktop** (`src/desktop/`) reads .NET/XAML projects (Avalonia, WinUI, WPF,
  MAUI): unwired controls, unlabeled controls, missing pointer cursors, literal
  colours/fonts, fixed or non-resizable layout, unvirtualized lists, blocking
  UI-thread calls, oversized views and axis-less charts.
- **Native** (`src/native/`) reads C/C++/Qt/CMake/MSBuild projects and shaders:
  unchecked `HRESULT`/`VkResult`, missing resize/swapchain recreation, unhandled
  device loss, unsafe C functions, shell execution, hard-coded credentials,
  detached threads, UI-thread sleeps, self-delete, fixed windows, missing
  pointer cursors, axis-less charts, placeholder copy, colour/path literals,
  missing tests/sanitizers/warnings, and absent Vulkan validation. With
  `--smoke <exe>` it launches the built app, resizes it through four sizes and
  reports a crash, hang or missing window.
- `--scan` adds cppcheck and clang-tidy (when a `compile_commands.json` exists)
  to the analyzer pass.

**Still planned**: an accessibility-tree and pixel-level runtime harness
(UI Automation on Windows, AX on macOS, AT-SPI on Linux) for rendered contrast,
control geometry and frame timing, and a cross-platform smoke probe.

## 4. Mobile applications (planned)

Android first (APKs are easier to obtain and inspect), then iOS.

**Static (no device):** unzip the APK/IPA; read `AndroidManifest.xml` /
`Info.plist`, permissions, resources and bundled strings; run the secret,
dependency and analyzer checks over the contents. Mobile-specific checks:
dangerous permissions, cleartext traffic allowed, backup enabled, exported
components, hardcoded endpoints.

**Dynamic (emulator/simulator):** install, screenshot, and read the view
hierarchy (`uiautomator` on Android, XCUITest on iOS) to drive the layout,
color, typography, accessibility and content checks. Reference Material 3 (48dp
targets) and Apple HIG (44pt targets).

**Deliverables**: `src/mobile/` adapter with `android` and `ios` modes, plus
platform-convention checks.

## What is deliberately out of scope

- **Paid services and hosted CI.** Everything runs locally via the CLI.
- **Auto-fixing.** The tool reports and suggests; it does not rewrite code.
- **State-changing or destructive tests.** `--deep` reads; it never writes.
- **Reimplementing SAST/SCA.** Orchestrate the real tools instead.
