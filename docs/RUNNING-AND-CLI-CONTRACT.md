# Running the CLI and the contract

How to run the audit yourself, and the exact contract any integration (the
opencode plugin, a git hook, a script) can rely on. This document is
descriptive: it does not add features. The auditor is stable and ready.

To wire this contract into an AI coding agent, see
[AI-AGENT-INTEGRATION.md](./AI-AGENT-INTEGRATION.md).

## Run it yourself

Three equivalent entry points. All take the same flags.

```bash
# from anywhere, on any project
node <AI-SiteSlopAudit>/bin/slopaudit.mjs audit <path-or-url>

# from inside the auditor repo
npx tsx src/cli.ts audit <path-or-url>
npm run audit -- <path-or-url>
```

Examples:

```bash
# a codebase, printed to the terminal
node bin/slopaudit.mjs audit .

# a codebase with the security analyzers that are installed
node bin/slopaudit.mjs audit . --scan

# a website, with screenshots and JSON + HTML + PDF reports
node bin/slopaudit.mjs audit https://example.com --screenshots --out reports/example --format json,html,pdf

# only the things you care about, strictly
node bin/slopaudit.mjs audit . --categories security,code --profile strict
```

Nothing about the audit needs the auditor repo to be your current directory.
`--config` and the automatic config lookup read from the current directory, and
the binary resolves its own sources relative to itself.

## The CLI contract

Anything integrating with the audit should treat this as the interface.

```
slopaudit audit <path|url> [flags]
slopaudit login <login-url> [flags]
slopaudit checks
slopaudit models
slopaudit init
```

**Stdout is data. Stderr is progress.** With `--format json`, the only thing on
stdout is one JSON object. All "collecting…", "running analyzers…", and "wrote
file…" messages go to stderr. An integration can `JSON.parse(stdout)` directly.

**Exit codes**: `0` success (and passed `--fail-under`), `1` below
`--fail-under`, `2` bad usage or invalid config. A guard that does not care can
ignore them.

### JSON shape an integration reads

```jsonc
{
  "tool": "slopaudit",
  "version": "0.1.0",
  "target": { "kind": "code" | "web", "label": "…", "ref": "…" },
  "profile": "default",
  "deterministic": {
    "score": 55.8,          // 0-100, higher is better
    "grade": "D",           // A B C D F
    "slopPoints": 44.2,
    "totalFindings": 26,
    "counts": { "critical": 0, "high": 7, "medium": 14, "low": 5, "info": 0 },
    "categories": [ { "category": "security", "score": 96.4, "penalty": 3.6, "findings": 6, … } ],
    "topFindings": [ /* highest-cost findings, each with ruleId, severity, title, detail, fix, evidence */ ]
  },
  "findings": [ /* every finding: ruleId, category, severity, title, detail, location?, fix?, confidence?, evidence[] */ ],
  "checks": [ { "checkId", "category", "ok", "findings", "durationMs?" } ],
  "warnings": [ "…" ],
  "llm": null | { "enabled", "model", "score", "grade", "summary", "findings" },
  "metadata": { "finalUrl?", "statusCode?", "analyzers?", "captures?", "deepProbe?" }
}
```

The two fields a guard needs are `deterministic.grade` / `.score` and
`findings[]`. Every finding carries a `fix`, and evidence with `file`/`line` or
`selector` for locating it.

## Ways to run it "between every code run"

All local. None of these is a hosted CI workflow.

### 1. opencode plugin (already present)

`~/.config/opencode/plugin/slop-guard.ts` already calls
`node <AI-SiteSlopAudit>/bin/slopaudit.mjs audit <target> --format json` after
edits settle, and exposes a `slop_audit` tool. It resolves the auditor via
`SLOPAUDIT_HOME` (default `~/Documents/GitHub/AI-SiteSlopAudit`) and the binary
via `bin/slopaudit.mjs`. Both exist and work from any directory. The contract
above is what it parses.

Connected (state as of this pass):

- The plugin runs a **code** audit on the project root with no extra flags, so
  the native checks always run and the `--scan` analyzers are **opt-in**:
  `SLOP_GUARD_SCAN=1` enables them in the guard, and the `slop_audit` tool takes
  a `scan` argument to run them on demand. They are off by default because
  `npm audit` reports many transitive dev-dependency advisories that are not
  "slop", and the automatic guard should stay fast and network-free. A URL
  target never scans.
- The split is **24** code checks (`audit <path>`) + **51** web checks
  (`audit <url>`) + **11** desktop checks (`audit <path> --type desktop`, or
  auto-detected for a .NET/XAML project) + **22** native checks
  (`audit <path> --type native`, or auto-detected for a CMake/Qt/.vcxproj/
  .uproject project) = the full **109**-check registry (`slopaudit checks`).
  The plugin's header states these numbers. Native audits accept
  `--smoke <exe>` to launch the built app and verify resize survival.
- `SLOP_GUARD_MIN_FILES`, `SLOP_GUARD_DEBOUNCE_MS`, `SLOP_GUARD_URL`,
  `SLOP_GUARD_DISABLE` control it. See its header.

### 2. npm / package script

In a project's `package.json`:

```json
{ "scripts": { "slop": "node ~/Documents/GitHub/AI-SiteSlopAudit/bin/slopaudit.mjs audit . --scan" } }
```

Then `npm run slop` before you commit.

### 3. Local git pre-commit hook

Blocks a commit when the score drops below a threshold. This is local, not a
hosted action. Create `.git/hooks/pre-commit` (chmod +x on unix):

```sh
#!/bin/sh
node "$HOME/Documents/GitHub/AI-SiteSlopAudit/bin/slopaudit.mjs" \
  audit . --scan --fail-under 70 >/dev/null
```

Exit code 1 stops the commit. `git commit --no-verify` bypasses it when
intentional.

### 4. Watch loop

Re-run on file changes while you work:

```bash
# unix
while true; do node bin/slopaudit.mjs audit . --categories security,code; sleep 5; done
```

A native `watch` command does not exist yet; if it would help, that is a
candidate feature (see [ROADMAP.md](./ROADMAP.md)).

## Security-tool coverage

`--scan` runs free analyzers when installed and skips the rest with a note:

```bash
pip install semgrep checkov bandit pip-audit
# plus single binaries: osv-scanner, trivy, gitleaks
```

`npm audit` already works wherever npm is. See
[GUARDRAILS.md](./GUARDRAILS.md) for the full list and what each covers.
`--deep` is a separate, active web probe and only for targets you are
authorized to test.

## Readiness checklist

Verified on the current tree:

- `npm run typecheck` — clean.
- `npm test` — 66 tests pass.
- security scan — clean.
- self-audit — A 100/100, 0 findings.
- `slopaudit checks` — 109 checks registered (24 code + 51 web + 11 desktop + 23 native).
- native target — A 100 on Focal (Qt), and a deliberately crashing WinForms
  fixture is caught as `native.runtime-resize-crash` (critical) by `--smoke`.
- External invocation from a foreign cwd returns valid JSON on stdout.
- `--categories`, `--profile`, `--scan`, web target, and exit codes all verified.

The auditor is ready to be called by opencode. The opencode side is now wired:
`~/.config/opencode/plugin/slop-guard.ts` points at `bin/slopaudit.mjs` (found
via `SLOPAUDIT_HOME`, defaulting to this repo), runs native checks always, and
offers `--scan` as an opt-in through `SLOP_GUARD_SCAN=1` or the `scan: true`
tool arg. The remaining optional step is a per-project git hook, above.
