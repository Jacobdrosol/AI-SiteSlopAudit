# Architecture

## The shape of the thing

```
                target (url | path)
                        |
                        v
                  target adapter        src/web, src/code
            (collects a raw snapshot)
                        |
                        v
                    snapshot            src/web/snapshot.ts, src/code/snapshot.ts
            (structured, serializable)
                        |
                        v
                   check registry        src/core/registry.ts
              (checks for this target kind)
                        |
                        v
                     runner              src/core/runner.ts
            (isolated, timed, fault-tolerant)
                        |
                        v
                   findings[]            src/core/types.ts
                        |
                        v
                  scoring engine         src/core/scoring.ts
               (penalties, decay, weights)
                        |
                        v
                  AuditReport            src/core/report.ts
                        |
            +-----------+-----------+
            v           v           v
        terminal      json        html      src/reporters
```

The optional LLM review runs after the deterministic report is built, reads it
as input, and writes a separate section. It is never on the path between the
snapshot and the grade.

## Why it is built this way

### Adapters, not a giant `if`

A **target adapter** takes a reference and returns a snapshot: a plain,
serializable object of everything the checks need. The web adapter drives a
headless Chromium and reads computed styles, geometry, network headers and
screenshots. The code adapter walks the filesystem and reads manifests and git.
Web, code, desktop (.NET/XAML) and native (C/C++/Qt/DX/Vulkan) adapters exist;
adding mobile means writing one more adapter, not touching the checks. The snapshot is the contract between collection and analysis.

### Checks are data, not control flow

A check is one object implementing a small interface:

```ts
interface Check<C> {
  id: string;
  category: Category;
  title: string;
  description: string;
  defaultSeverity: Severity;
  appliesTo: TargetKind[];      // web, code
  run(ctx: CheckContext<C>): Finding[] | Promise<Finding[]>;
}
```

There is no orchestrator that knows about individual checks. The registry holds
them, the runner runs the ones whose `appliesTo` matches, and scoring never
looks at check identities except through the rule id. This is why 109 checks can
exist without any of them knowing about each other.

### Determinism is the product

The whole point is a grade you can trust and reproduce. Two rules enforce it:

1. Checks only measure. No randomness, no network beyond the target itself, no
   model calls.
2. The same snapshot and profile always produce the same score.

The LLM layer exists and is deliberately quarantined: it can only add a labeled,
non-authoritative second opinion, and it cannot move the number.

### Fault isolation

The runner wraps every check in its own try/catch and records errors rather than
crashing the audit (`src/core/runner.ts`). One check with a bug produces a
warning and a missing result, not a failed run. There is a test for this.

## Module map

```
src/core/
  types.ts         Finding, Check, Severity, Category, the shared vocabulary
  registry.ts      holds checks, filters by target kind, rejects duplicate ids
  runner.ts        runs checks in isolation, collects findings and errors
  scoring.ts       penalties, per-rule decay, category scores, grade bands
  config.ts        built-in profiles and how a profile resolves to numbers
  file-config.ts   load and validate slopaudit.config.json (fails loudly)
  report.ts        the AuditReport shape and the LLM result shape

src/web/
  collector.ts     Playwright: snapshot the rendered page + screenshots
  snapshot.ts      the WebSnapshot shape
  color.ts         color parsing, compositing, WCAG contrast
  checks/          layout, typography, color, content, components,
                   responsive, accessibility, security
  index.ts         exports the web check list

src/code/
  collector.ts     walk the tree, read manifests, inspect git
  snapshot.ts      the CodeSnapshot shape and the language table
  checks/          code-quality, secrets, dependencies
  index.ts         exports the code check list

src/reporters/
  terminal.ts      the human report
  json.ts          the machine report
  html.ts          the shareable report (all untrusted content escaped)

src/llm/
  ollama.ts        the optional local model review

src/cli.ts         argument parsing, target detection, orchestration
bin/slopaudit.mjs  the executable entry point
```

## Data flow in detail

1. **Detect the target.** `detectTarget` in `src/cli.ts` classifies the argument
   as web or code, unless `--type` overrides it.
2. **Load and validate config.** `loadFileConfig` finds a config file, and
   `validateFileConfig` rejects bad profiles, severities and weights with exit
   code 2. Nothing proceeds on an invalid rubric.
3. **Collect.** The web adapter navigates, waits for the network to settle,
   evaluates a large in-page function to extract computed styles and geometry
   at desktop width, then loops the configured viewports capturing overflow
   metrics and screenshots. The code adapter walks the tree (skipping
   `node_modules`, build output, binaries, generated files), reads manifests for
   npm/pip/cargo/go, and inspects git.
4. **Run checks.** The runner selects checks by `appliesTo` and by the active
   categories and disabled rules, runs them, and normalizes severity. Errors are
   captured per check.
5. **Score.** Each finding adds slop points: its rule's weight (how diagnostic of
   slop it is), scaled by confidence, plus a fraction for each repeat. The score
   is `100 - total slop points`. See [../rubric/SCORING.md](../rubric/SCORING.md).
6. **Report.** Terminal, JSON and HTML render from the same `AuditReport`.
7. **Optional LLM.** If requested, the deterministic report is serialized into a
   prompt, the model returns JSON, and the result is coerced into the report's
   LLM section.

## Key interfaces

The whole system is defined by three shapes in `src/core/types.ts`:

- **`Finding`** - one problem: `ruleId`, `category`, `severity`, `title`,
  `detail`, optional `evidence[]`, optional `fix`, optional `confidence`.
- **`Check<C>`** - described above.
- **`ResolvedConfig`** - the numbers scoring uses: severity penalties, category
  weights, rule decay, and per-rule overrides.

If you understand these three, you understand the tool.

## Safety properties

- **HTML escaping.** Anything from an audited target is attacker-controlled.
  Every value in the HTML reporter passes through an `esc()` helper, and there
  is a test that feeds a `<script>` payload through and asserts it cannot
  survive.
- **Secret redaction.** The code secret scan redacts the matched value in the
  evidence (`sk_l...redacted...uv`), so running the tool does not redistribute
  the credential it found.
- **Fault isolation.** A throwing check degrades the run, it does not end it.
- **No secrets of its own.** The tool reads no credentials and only talks to the
  target and, optionally, a local Ollama instance.
