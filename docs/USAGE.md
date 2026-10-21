# Usage

## Install

```bash
npm install
npx playwright install chromium
```

Node 20 or newer. Chromium is only needed for web targets; code audits work
without it.

## The command line

```
slopaudit audit <url|path>   run an audit
slopaudit login <login-url>  authenticate once, save the session
slopaudit checks             list every check and its default severity
slopaudit models             list local Ollama models
slopaudit init               write a starter config file
slopaudit help               show help
```

Three equivalent ways to run it:

```bash
npx tsx src/cli.ts audit https://example.com     # direct
npm run audit -- https://example.com             # via npm script
node bin/slopaudit.mjs audit https://example.com # the binary
```

To get `slopaudit` on your PATH, run `npm install -g .` from the repo root.

## Selecting a target

The tool decides what kind of thing it is looking at from the argument:

- Starts with `http://` or `https://` -> a web target.
- Looks like a bare domain (`example.com`) -> a web target, `https://` prepended.
- A path with a .NET project file and `.axaml`/`.xaml` views -> a desktop target.
- A path with `CMakeLists.txt`, a Qt `.pro`, `.vcxproj`, `.uproject`,
  `meson.build`, `xmake.lua` or `premake5.lua` and C/C++ sources -> a native
  target.
- Anything else -> a local path, a code target. The path is resolved to an
  absolute path.

Override the guess with `--type web|code|desktop|native`.

```bash
slopaudit audit https://example.com          # website
slopaudit audit example.com                  # website
slopaudit audit .                            # code in the current directory
slopaudit audit C:\\projects\\my-app          # code at a path
slopaudit audit C:\\projects\\my-app --type native --smoke build/Release/App.exe
```

Note: a local `.html` file cannot be audited by URL. Serve it over http first
(for example `npx http-server ./fixtures`) and audit the URL. See
[IMPROVEMENTS.md](./IMPROVEMENTS.md) for the planned `file://` support.

## Auditing pages behind a login

Protected pages redirect to a login screen, so you need a saved session first.

```bash
# 1. Log in once. Works for SPAs; tokens are captured from localStorage/cookies.
slopaudit login http://localhost:3000/login \
  --email you@example.com --password 'yourpassword' \
  --save .slopaudit-auth.json

# 2. Audit authenticated pages with the saved session.
slopaudit audit http://localhost:3000/dashboard --storage-state .slopaudit-auth.json
```

If the form fields are not `#email` / `#password`, point at them:

```bash
slopaudit login http://localhost:3000/admin/login \
  --email admin@example.com --password 'secret' \
  --email-selector 'input[type="email"]' \
  --password-selector 'input[type="password"]' \
  --submit-selector 'button[type="submit"]' \
  --save .slopaudit-admin.json

slopaudit audit http://localhost:3000/admin/lessons --storage-state .slopaudit-admin.json
```

Flags for `login`:

| Flag | Meaning |
| --- | --- |
| `--email <e>` / `--password <pw>` | Credentials. Omit to just capture an existing session. |
| `--save <file>` | Where to write storage state. Default `.slopaudit-auth.json`. |
| `--email-selector <s>` | Default `#email`. |
| `--password-selector <s>` | Default `#password`. |
| `--submit-selector <s>` | Default `button[type="submit"]`. |
| `--success-url <regex>` | URL pattern proving login worked. |
| `--success-selector <s>` | Element that appears only after login. |
| `--headed` | Show the browser, for debugging. |

The session file holds bearer tokens. It is gitignored by default and must never
be committed. Audit warns you if a page still redirects to `/login` after
loading the session, which means the session expired or lacks access to the route.

**Windows Git Bash note:** a leading-slash value like `--success-url /dashboard`
gets rewritten by MSYS path translation. Either drop the flag (the default
detection works), or prefix the command with `MSYS_NO_PATHCONV=1`.

## Common runs

```bash
# Plain terminal report
slopaudit audit https://example.com

# Full detail, including the fix for every finding
slopaudit audit https://example.com --verbose

# JSON to stdout for scripting
slopaudit audit https://example.com --format json

# Write JSON and HTML reports to a folder
slopaudit audit https://example.com --format json,html --out reports

# Save viewport screenshots (web only)
slopaudit audit https://example.com --screenshots --out reports

# Audit a codebase, ignore the UI categories
slopaudit audit ./my-project --categories security,dependencies,code

# Skip a noisy rule
slopaudit audit https://example.com --disable layout.uniform-padding

# Only audit security and accessibility, strictly
slopaudit audit https://example.com --categories security,accessibility --profile strict
```

## Flags

| Flag | Takes | Meaning |
| --- | --- | --- |
| `--profile <name>` | name | Rubric profile (see below). |
| `--type <web\|code\|desktop\|native>` | web, code, desktop, native | Force the target type. |
| `--categories <list>` | comma list | Only run these categories. |
| `--disable <list>` | comma list | Skip these rule ids. |
| `--format <list>` | terminal, json, html | Output format(s). Default `terminal`. |
| `--out <dir>` | path | Write `report.json` / `report.html` into a directory instead of stdout. |
| `--screenshots` | | Save a viewport screenshot per width (web). |
| `--full-page` | | Full-page screenshots instead of viewport. |
| `--viewports <list>` | comma list | Widths to test. Default `1440,768,375`. |
| `--timeout <ms>` | number | Page load timeout. Default 30000. |
| `--include <list>` | comma list | Code target: only scan paths/extensions matching. |
| `--max-files <n>` | number | Code target: cap files scanned. |
| `--storage-state <f>` | path | Playwright storage state JSON, for authenticated pages. |
| `--deep` | | Active security probe: exposed files, user enumeration, secrets in JS bundles. Only on targets you are authorized to test. |
| `--scan` | | Code/native targets: run installed analyzers (npm audit, semgrep, osv-scanner, trivy, gitleaks, checkov, bandit, pip-audit, cppcheck, clang-tidy). Missing tools are skipped. |
| `--disable-analyzer <id>` | id | Skip one analyzer, e.g. `sca.trivy`. |
| `--smoke <exe>` | path | Native targets: launch the built app, resize and move it, and report a crash, hang or missing window. Windows-only today. |
| `--smoke-timeout <ms>` | number | Wait for the first window before the smoke probe gives up. Default 20000. |
| `--llm` | | Run the local Ollama review too. |
| `--model <name>` | name | Model for `--llm`. Required; pick your own. |
| `--llm-only` | | Run only the model review, no deterministic grade. |
| `--llm-url <url>` | url | Ollama base URL. Default `http://127.0.0.1:11434`. |
| `--config <path>` | path | Use a specific config file. |
| `--fail-under <n>` | 0-100 | Exit non-zero if the score is below n. |
| `--verbose` | | Full detail and fixes in the terminal. |
| `--no-color` | | Disable ANSI color. |
| `-h`, `--help` | | Show help. |

## Profiles

A profile changes how harsh the grade is and which categories matter most. The
checks are identical; only the scoring changes.

| Profile | Use it for |
| --- | --- |
| `default` | Balanced grading. |
| `strict` | Grading someone else's work where near-perfection is expected. |
| `marketing-site` | Landing pages, where visual design and copy matter most. |
| `a11y-first` | Accessibility-critical products. |
| `lenient` | Your own work in progress, without being buried. |

```bash
slopaudit audit https://example.com --profile marketing-site
```

## Exit codes

This is the interface automation depends on.

| Code | Meaning |
| --- | --- |
| `0` | Audit completed. (With `--fail-under`, also means the score passed.) |
| `1` | Score was below `--fail-under`. |
| `2` | Bad usage or invalid config. |

```bash
slopaudit audit https://staging.example.com --profile strict --fail-under 85 \
  --format json --out reports
```

That writes `reports/report.json` and `report.html`, and exits 1 if the score is
under 85. Branch on the exit code in any CI or script.

## Reading the report

**Every finding includes a suggested fix** (`fix:` line), the evidence behind it
(selectors, measured values, file:line), and a points cost. Nothing is reported
without a concrete, bounded change to make.

The terminal report has four parts:

1. **Header** - target, profile, elapsed time.
2. **Quality score** - the letter, score out of 100, and the slop points behind it.
3. **By category** - a score per category, lowest first.
4. **Priority fixes** - findings ranked by points cost, so the ones that move the
   score most are first. `--verbose` adds full detail, the fix for each, and a
   **full breakdown** of every finding grouped by category.

The HTML report (`--format html`) is the complete version and contains, in order:

- **Quality score** with band label and slop-point total.
- **Fix these first** - every high-value finding with its points, evidence and fix.
- **By category** - score, slop points and findings per category.
- **Full breakdown** - *every* finding, grouped by category, worst category first,
  each with evidence and fix. Nothing is truncated.
- **Check coverage** - a collapsible table of every check that ran, how many
  findings each produced, and any that failed.

The JSON report is the machine-readable form and contains the same data:
`deterministic` (score, grade, slopPoints, per-category and per-rule breakdown),
`findings` (the complete list, each with `fix`, `evidence`, `confidence`),
`checks`, `warnings`, and `llm`.

```bash
slopaudit audit https://example.com --format html --out reports   # open reports/report.html
slopaudit audit https://example.com --verbose                     # full breakdown in the terminal
```

## Configuration file

Run `slopaudit init` to write `slopaudit.config.json` in the current directory.
The tool loads it automatically, or you can point at one with `--config`.

```json
{
  "profile": "default",
  "llm": { "enabled": false, "model": "qwen3-coder:30b" },
  "rules": {
    "color.purple-blue-gradient": { "severity": "high" },
    "layout.uniform-padding": { "enabled": false }
  },
  "web": { "viewports": [1440, 768, 375] },
  "code": { "maxFiles": 8000 },
  "failUnder": 70
}
```

Invalid config fails loudly with exit code 2 rather than silently changing the
grade. See [CONFIGURATION.md](./CONFIGURATION.md) for the full surface, including
custom profiles.

## The LLM review

Separate from the deterministic grade, opt in with `--llm`.

```bash
slopaudit models                                          # see what you have
slopaudit audit https://example.com --llm --model qwen3-coder:30b
slopaudit audit ./my-project --llm-only --model llama3.1:70b
```

The model's score and findings are clearly labeled non-authoritative and never
feed the real grade. See [LLM.md](./LLM.md).
