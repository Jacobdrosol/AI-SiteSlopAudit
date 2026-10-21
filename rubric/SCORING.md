# Scoring rubric

The score is deterministic: the same target and profile always produce the same
number. This document is the contract.

The headline number is a **quality score**: 0-100, where **higher is better**.
It is derived from a **slop score**: the sum of points contributed by every
matched signal. `quality = 100 - slop`, clamped to 0.

## Why additive, not subtractive

Earlier versions of this tool subtracted penalties from 100 with an exponential
curve. That sounds reasonable and is wrong in practice: because most sites have
*some* findings, and the curve punished the first finding heavily, nearly
everything collapsed into the same low score. A polished production site and a
careless one landed within a few points, which made the number useless.

This rubric instead **adds up slop points**. A clean site accumulates almost no
points and scores in the 90s; a sloppy site accumulates many and scores low. The
score is a measure of *how many slop tells were found*, and it spreads out
across real sites the way a person's judgment does.

## Step 1: findings

Every check emits zero or more findings. Each finding has a category, a
severity, and a rule id.

## Step 2: slop weight per rule

Each rule has a weight: how many slop points one instance is worth. This is the
heart of the score. Crucially, the weight reflects **how diagnostic the signal
is of slop**, not how severe the underlying bug is. A repeated decorative motif
or a template hero says far more about machine-assembled work than a missing
`X-Content-Type-Options` header does, so it is worth far more points.

Representative weights (the full table is `DEFAULT_SLOP_WEIGHTS` in
`src/core/config.ts`):

| Rule | Weight | Why |
| --- | --- | --- |
| `layout.motif-stacking` | 12 | the defining tell: repeated decoration |
| `layout.hero-signature` | 10 | the generic AI landing template |
| `content.lorem-placeholder` | 12 | placeholder copy shipped |
| `color.purple-blue-gradient` | 10 | the signature AI gradient |
| `content.ai-voice` | 9 | "Elevate", "Seamless", "Unlock" |
| `type.default-font` | 6 | Inter/Roboto/system-ui by reflex |
| `type.gradient-text` | 6 | gradient text |
| `components.glassmorphism` | 5 | frosted glass by default |
| `layout.equal-card-grid` | 5 | uniform card grid |
| `responsive.horizontal-overflow` | 3 | real layout break |
| `a11y.unlabeled-controls` | 2 | real accessibility failure |
| `color.non-token` | 0.5 | untokenized color |
| `security.nosniff` | 0.3 | missing hardening header |
| `native.runtime-resize-crash` | 25 | real crash when the window resizes |
| `native.secret-literal` | 15 | credential compiled into the binary |
| `native.unchecked-api-result` | 12 | failed GPU call used as success |
| `native.resize-path-missing` | 12 | the classic resize crash |
| `native.no-tests` | 6 | native logic with no test target |
| `native.qt-native-child-host` | 5 | native window fighting Qt pane layout |

The intent is visible in the last three rows: a missing `nosniff` header is
worth about 1/40th of a repeated decorative motif. Hardening and hygiene issues
are real, but they are not what "slop" means.

Rules not listed fall back to a per-category default
(`DEFAULT_CATEGORY_SLOP`), so a newly added check gets a sane weight without you
touching the table.

## Step 3: repeats

The first instance of a rule counts fully. Each additional instance adds
`instanceDecay` of that rule's weight (default 0.5). So a tell seen three times
is worth `base * (1 + 0.5 + 0.5) = 2 * base`, not `3 * base`: repetition matters,
but the same tell repeated fifty times does not bury everything else.

`confidence` also scales a finding (a 0.5-confidence heuristic counts half).

## Step 4: overall score

```
slopPoints = SUM over findings of (ruleWeight * confidence * repeatFactor)
quality    = max(0, min(100, 100 - slopPoints))
```

Per-category scores are also reported, each as `100 - (that category's slop
points)`, so you can see which area is worst. These are informational: unlike an
earlier version, the overall score is **not** a weighted average of categories
and is **not** dragged toward the worst category. If you want that behavior,
set `worstCategoryWeight` and `breadthPenalty` in a custom profile and they will
be applied.

## Step 5: bands

| Quality | Grade | Label |
| --- | --- | --- |
| 90-100 | A | hand-crafted |
| 78-89 | B | mostly built |
| 64-77 | C | showing slop |
| 50-63 | D | vibe-coded |
| below 50 | F | pure slop |

## What this produces

Measured on real sites:

| Target | Quality | Slop points | Note |
| --- | --- | --- | --- |
| slopaudit itself | 100 | 0 | no signals |
| walmart.com | ~92 | ~8 | no slop tells; only hygiene nits |
| heycatch.ai | ~75 | ~25 | one hero template, some glass |
| a local dev app (ZepNotes) | 58-80 | 20-42 | motif stacking on the landing page |
| cloudiway.com | ~30 | ~70 | almost every tell at once |

The ordering is the point: a real production site scores high because it has no
slop tells, and a template-driven site scores low because it has many.

## Changing the rubric

- **Per rule**: in config, set `slopWeights.<ruleId>` to change its points, or
  `rules.<ruleId>.weight` to scale it, or `rules.<ruleId>.enabled: false` to drop
  it. `rules.<ruleId>.severity` relabels it.
- **Everything a profile offers**: `severityPenalties`, `categoryWeights`,
  `ruleDecay`, `worstCategoryWeight`, `breadthPenalty`, plus `slopWeights` and
  `instanceDecay`, can be set in a custom profile.
- **Softer or harsher**: `--profile lenient` / `--profile strict`.

The LLM review reports its own score and never feeds into these numbers.
