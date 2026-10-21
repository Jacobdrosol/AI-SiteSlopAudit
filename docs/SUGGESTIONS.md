# Context-aware suggestions (future capability)

Today every finding ships with a **fix template**: a specific, bounded change,
but written for the rule, not for your exact markup. It says "keep one decorative
device and drop the rest", not "the three icon tiles in your `How it works`
section at `src/components/HowItWorks.tsx:42` are the ones to cut".

This document describes how to add the second kind: **context-aware suggestions**
that reference the concrete elements, files and values a specific run found, and
that can be turned into a patch. It is a design, not an implementation. Nothing
here exists yet.

## Why it is not the default

A rule-level fix is deterministic, cheap, and cannot be wrong about facts. A
per-element suggestion needs to reason about a specific element's role, which is
exactly the kind of judgment a model can get wrong. So the design keeps the two
separate:

- The **rule fix** stays. It is the floor: always present, always safe.
- The **contextual suggestion** is additive, opt-in, and clearly labeled.

It never changes the deterministic score. The score is computed from checks, and
checks do not call a model. Suggestions are annotations on top of the report.

## The shape

A suggestion attaches to a finding and is produced in one of two ways: a
deterministic template that fills in the finding's real evidence, and an optional
model pass for the cases a template cannot express.

```ts
interface Suggestion {
  findingRuleId: string;
  /** Deterministic and always present. */
  template: string;
  /** Optional, model-generated, references real elements. */
  contextual?: {
    text: string;
    /** Concrete edits, each pointing at a real target. */
    edits: Array<{
      kind: "css" | "html" | "token" | "code";
      target: string;        // selector or file:line
      before?: string;       // what is there now (from the snapshot)
      after?: string;        // what to change it to
    }>;
    /** A unified diff, when the target is a file and a patch is possible. */
    patch?: string;
  };
  source: "template" | "model";
  confidence?: number;
}
```

The key discipline: a contextual suggestion must cite a `target` that came from
the snapshot (a real selector, a real file path and line). A suggestion that
invents an element is invalid and must be dropped, not shown.

## Deterministic contextual suggestions (do this first)

Most of the value needs no model at all. A finding already carries evidence:
selectors, measured values, file paths, line numbers. A template can interpolate
those into a concrete sentence. This gets you 80% of the way and stays
deterministic.

Examples:

- **Motif stacking.** The evidence already lists which motif kinds and counts.
  Template: "Your repeated decoration is dominated by 20 eyebrow badges and 33
  icon tiles. Remove the tiles in the 6 sections below and keep the eyebrow badge
  only on the hero." The section list is real, pulled from the DOM.
- **Contrast.** Evidence has the exact selector, foreground and background.
  Template: "Change `.muted-caption` at `p:nth-of-type(2)` from `#898b92` to at
  least `#5f6167` to reach 4.5:1 on `#ffffff`." The target hex is computed by
  searching along the lightness axis until the ratio passes, which is
  deterministic.
- **Default font.** Evidence has the dominant family and the CSS variables.
  Template: "Body resolves to `Inter`. Set `--font-body` in your token block and
  switch the stack to a named font." The variable name is read from the snapshot
  when one exists.
- **Dependency / secret findings.** Evidence already has `file:line`. Template:
  "Remove the token at `src/config.js:2` and read it from `process.env`."

Rule of thumb: if the fix can be written by string-substituting the finding's own
evidence, it belongs in the deterministic tier and should be built before any
model is involved.

## The model tier (opt-in)

For the cases a template cannot express, an optional pass sends the finding and
its evidence to the local Ollama model (the same layer documented in
[LLM.md](./LLM.md)) and asks for a bounded suggestion with explicit edits. This
reuses the existing local, no-network design.

Constraints that keep it honest:

1. **Never in the scoring path.** It runs after the score is final, and the score
   is never revised by it.
2. **Cite or drop.** Every edit must reference a selector or `file:line` that is
   present in the snapshot. Anything else is discarded before it reaches the
   report.
3. **Labeled.** Suggestions carry `source: "model"` and render under a clearly
   marked heading, exactly like the existing non-authoritative LLM section.
4. **Off by default.** `--suggest --model <name>` to enable. `--suggest` alone
   runs only the deterministic tier.

## Turning suggestions into patches

A `patch` is a unified diff produced from a suggestion and the real file. This is
the natural next step after contextual code and web-source suggestions, but it
introduces real risk, so it is deliberately staged:

- **Stage 1 — print only.** Suggestions are shown as before/after and as a diff,
  but the tool never writes a file. The human applies it. This is the safe
  default and matches the current "report, do not rewrite" stance.
- **Stage 2 — write to a branch.** `--apply` writes the diff to a new git branch,
  never to the working tree, and never commits. A human reviews the diff. This
  keeps the "never auto-fix silently" principle while removing the copy-paste.
- **Stage 3 — PR preparation.** Optionally stage the branch for the user to open
  as a PR themselves. The tool still does not push anything.

Auto-committing or pushing is out of scope and stays on the "deliberately not
planned" list, because silently rewriting someone's code is the same category of
harm as the slop this tool audits.

## Where it lives in the code

Following the existing architecture ([ARCHITECTURE.md](./ARCHITECTURE.md)):

- `src/core/suggestions.ts` — the `Suggestion` type and the deterministic
  template engine that interpolates finding evidence.
- Per-rule suggestion templates live next to the rule, or in a
  `suggestions` map keyed by rule id, mirroring `DEFAULT_SLOP_WEIGHTS`.
- `src/llm/suggestions.ts` — the optional model tier, reusing the Ollama client
  from `src/llm/ollama.ts` and its JSON-coercion helpers.
- Reporters render `Suggestion[]` under each finding: the template line always,
  the contextual block when present and labeled.
- CLI: `--suggest` (deterministic tier only) and `--suggest --model <name>`
  (adds the model tier), plus `--apply` behind the staged plan above.

Because suggestions hang off findings and reporters, adding them touches no
check and no scoring code. The rule-fix floor means the report is never emptier
if the model is unavailable.

## How it would be validated

The same standard as the checks:

- **Deterministic tier**: unit tests that feed a fixture finding and assert the
  template interpolates the real evidence and cites a real target.
- **Model tier**: assert that a suggestion citing a target not present in the
  snapshot is dropped; assert the score is byte-identical with and without
  `--suggest`. A model suggestion must not be able to move the number.
- **Patch tier**: a test that the diff applies cleanly to the fixture and that
  `--apply` never touches the working tree or creates a commit.

## Honest caveats

- Per-element suggestions are where a model is most likely to be confidently
  wrong. The "cite or drop" rule and the visible `source` label are the
  mitigations, not a guarantee.
- A useful contextual suggestion needs the finding's evidence to be rich. Some
  checks currently report few evidence items, so those suggestions would be thin
  until the evidence is improved. That evidence work is tracked in
  [IMPROVEMENTS.md](./IMPROVEMENTS.md).
- Writing patches to web markup is only meaningful when the tool has the source,
  not the rendered DOM. For a live URL, suggestions can describe the change but a
  patch needs the repo, so `--apply` is a **code target** feature.
