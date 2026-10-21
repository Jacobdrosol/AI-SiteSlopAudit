# slopaudit

**A deterministic auditor for AI-generated slop in websites, codebases, desktop
apps, and native C/C++ projects.**

`slopaudit` looks for the specific, recognizable signs of careless generated
work: reflex font choices and broken type scales, the purple-to-blue gradient,
the centered hero over three equal cards, emoji in copy, mixed sizes inside one
text block, weak contrast, unlabeled controls, missing security headers,
hard-coded secrets, abandoned scaffolding, and native lifecycle defects.

It produces a reproducible 0-100 quality score, a letter grade, and a ranked
list of findings with `file:line` or CSS-selector locations and a concrete fix.

The grade is **computed, not guessed**. Every finding comes from something the
tool measured: a rendered font size, a real contrast ratio, a response header,
a token in a source file, a call site in a C++ project. That matters because
asking a language model to "rate this site" is non-deterministic and is itself
the kind of thing this tool exists to catch.

## Why this exists

AI-generated interfaces converge. The same fonts, the same gradients, the same
hero, the same equal card grid, the same placeholder copy, and the same
unchecked native API calls show up across unrelated projects. Reviewers can
feel the sameness but cannot point at it consistently.

This tool turns that feeling into a fixed, testable rubric. It is meant to be
run by a developer before calling work finished, by a reviewer before merging,
and by an agent after a substantial pass. It is deliberately unkind to its own
output: the audit is allowed to fail the project it is run on.

## What it audits

| Target | Input | Checks | Notes |
| --- | --- | ---: | --- |
| Website | `https://...` or `example.com` | 51 | Headless Chromium measures the rendered page, not the source alone |
| Codebase | a local path | 24 | Code quality, dependencies, secrets, AI tells |
| Desktop app (.NET/XAML) | a project path | 11 | Unwired controls, fixed layout, blocking UI-thread work, chart labels |
| Native app (C/C++/Qt/DX/Vulkan) | a project path | 23 | Unchecked `HRESULT`/`VkResult`, resize/device-loss paths, unsafe C, Qt layout traps, missing tests/sanitizers |
| Mobile app | apk / ipa | planned | See [roadmap](docs/ROADMAP.md) |

The full registry is **109 checks**. The native target can additionally launch
a built executable with `--smoke <exe>` and resize it through four sizes; a
crash, hang, or early exit is reported as a high-severity finding.

## Quick start

Requires Node.js 20 or newer.

```bash
git clone https://github.com/Jacobdrosol/AI-SiteSlopAudit.git
cd AI-SiteSlopAudit
npm ci
npx playwright install chromium
```

Audit a live site:

```bash
npx tsx src/cli.ts audit https://example.com
```

Audit a project and write JSON and HTML reports:

```bash
npx tsx src/cli.ts audit . --format json,html --out reports
```

Audit a native app and verify it survives a resize:

```bash
npx tsx src/cli.ts audit . --type native --smoke build/Release/App.exe
```

Use the strict rubric, save screenshots, and fail CI below 80:

```bash
npx tsx src/cli.ts audit https://example.com --profile strict \
  --screenshots --fail-under 80
```

## Commands

```text
slopaudit audit <url|path>   run an audit
slopaudit checks             list every check and its default severity
slopaudit models             list local Ollama models
slopaudit init               write a starter config
```

Run `slopaudit audit --help` for every flag.

## The score

The headline number is a quality score: 0-100, higher is better. Each matched
signal adds slop points, weighted by how diagnostic it is. A repeated
decorative motif is worth much more than a missing `X-Content-Type-Options`
header. The score is `100 - total slop points`.

This is additive on purpose. A clean site accumulates almost no points and
lands in the 90s; a template-driven one accumulates many and lands low. That is
what makes the number spread across real sites instead of collapsing.

Profiles adjust emphasis, not facts:

- `default` - additive slop score; a clean site scores in the 90s.
- `strict` - higher weights for grading someone else's work.
- `marketing-site` - visual design and copy carry more weight.
- `a11y-first` - accessibility and semantics dominate.
- `lenient` - for auditing your own work in progress.

See [rubric/SCORING.md](rubric/SCORING.md) for the weight table, grade bands,
and how to change them.

## What it checks

The checks come from a fixed ban list, not from taste:

- No emoji in copy or as icons.
- No default font stacks chosen by reflex (Inter, Roboto, system-ui) without a
  deliberate choice.
- No purple/indigo-to-blue gradients, gradient text, or glassmorphism by
  default.
- No centered hero + subhead + two pill buttons over three equal feature cards.
- No equal-weight card grids as the default presentation.
- No placeholder copy presented as final.
- No AI marketing voice ("Elevate", "Seamlessly", "Unlock", "It's not just X,
  it's Y").
- No fabricated testimonials, stats, or logos.
- One icon library with a consistent stroke weight; no emoji-as-icon.
- Body contrast at least 4.5:1; touch targets large enough to use.
- Secrets never shipped to the client; security headers present.
- Native APIs checked immediately; resize, device loss, and teardown handled;
  no unsafe C string functions or shell construction; no detached threads or
  UI-thread sleeps.
- A native render window embedded in a Qt pane layout is flagged, because Qt
  does not own that window's geometry and it can cover the panes.

Every check can be wrong. [docs/CHECKS.md](docs/CHECKS.md) says how each one
works and where its confidence is limited.

## LLM review is optional and separate

The deterministic grade never includes a model's opinion. The optional LLM
section is a second opinion, labeled non-authoritative in both terminal and HTML
output.

```bash
npx tsx src/cli.ts models
npx tsx src/cli.ts audit https://example.com --llm --model qwen3-coder:30b
npx tsx src/cli.ts audit ./my-project --llm-only --model llama3.1:70b
```

The model is asked for strict JSON and its answer is coerced into the same
finding shape as the deterministic checks. An unparseable answer fails that
section without affecting the real grade. The review talks to your local Ollama
instance; it does not send code to a cloud service.

## Safety and honest limits

- The web target uses headless Chromium. It measures what a browser computed,
  not what a template intended.
- The code target uses text heuristics. It does not build a full AST, so some
  code-quality findings are confidence-scored and can be false positives.
- The secret and dependency checks are pattern- and manifest-based. They are
  not a substitute for a real SAST tool, `npm audit`, or a human review.
- The native target is static analysis plus an optional process smoke test. It
  does not prove correctness, and a successful resize does not prove the app
  works.
- Do not run `--smoke` on an untrusted binary.

## Development

```bash
npm ci
npm run typecheck
npm test
npx tsx src/cli.ts checks
```

The registry lives in `src/core`, the target adapters in `src/web`, `src/code`,
`src/desktop`, and `src/native`, reporters in `src/reporters`, and the optional
model layer in `src/llm`.

Adding a check means writing one object with an `id`, `category`, `severity`,
`appliesTo`, and a `run` that returns findings, then adding a regression test.
Nothing else needs to change. See [docs/EXTENDING.md](docs/EXTENDING.md).

## Contributing

Issues and discussions are welcome. The `main` branch is protected: outside
contributors cannot push to it. Fork the repository, make a branch, and open a
pull request. The owner can bypass the protection for maintenance commits.

Keep changes deterministic. A check must measure something reproducible, and a
new check needs a test that proves both its positive and negative cases.

## License

MIT. See [LICENSE](LICENSE).
