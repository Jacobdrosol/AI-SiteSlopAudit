# Extending slopaudit

Three kinds of contribution: a new check, a new reporter, or a new target
adapter. Only the first is common.

## Add a check

A check is one object. Nothing else needs to change: the registry picks it up
from the exported list, the runner schedules it, and scoring uses its rule id.

1. Add it to the right file in `src/web/checks/` or `src/code/checks/`.
2. Export it in that folder's array (they are already spread into `src/web/index.ts`
   and `src/code/index.ts`).

```ts
import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

export const myChecks = [
  defineCheck<WebSnapshot>({
    id: "layout.my-rule",              // unique, category-prefixed
    category: "layout",
    title: "Short human title",
    description: "One line describing what it does.",
    defaultSeverity: "medium",
    appliesTo: ["web"],                // or ["code"], or both
    run({ data }): Finding[] {
      const offenders = data.textNodes.filter(/* ... */);
      if (offenders.length === 0) return [];
      return [{
        ruleId: "layout.my-rule",
        category: "layout",
        severity: "medium",
        title: "What is wrong",
        detail: "Measured evidence and why it reads as slop.",
        location: offenders[0]!.selector,
        evidence: [{ label: "selector", selector: offenders[0]!.selector }],
        fix: "One bounded, specific change.",
      }];
    },
  }),
];
```

### Rules for a good check

- **Measure, do not guess.** Read from the snapshot. If it is heuristic, set
  `confidence` below 1 and say so.
- **Return no findings on a clean target.** False positives on good work are the
  fastest way to make the tool untrustworthy. Every check should have a passing
  case in the tests.
- **Evidence, not adjectives.** The finding should quote the measured value
  (the ratio, the size, the header) so a reader can verify it.
- **One bounded fix.** Never "redesign the page". The fix maps to a specific
  change, ideally to a token.
- **Fail safely.** If `data` does not have what you expect, return `[]` rather
  than throwing. The runner will catch a throw, but a clean empty return is
  better.
- **`ruleId` must equal `id`.** They are the same string; scoring keys on it.

### Severity

- `critical` - actively dangerous (a leaked secret). Rare.
- `high` - clearly broken or a real security/a11y failure.
- `medium` - visible slop or a usability problem.
- `low` - polish and consistency.
- `info` - worth noting, little weight.

### Testing a check

Add a case to `src/web/checks.test.ts` (or a new `*.test.ts`). Build a minimal
snapshot with the fault and assert your rule fires, then build a clean one and
assert it does not.

```bash
npm test
npm run typecheck
```

## Add a reporter

A reporter takes an `AuditReport` and returns a string (or writes files).

1. Create `src/reporters/mine.ts` exporting a `renderMine(report)` function.
2. If it is a file format, wire it into the `--format` switch in `src/cli.ts`.

**Security requirement:** any reporter that produces markup must escape every
value that came from the target. See the `esc()` helper in
`src/reporters/html.ts` and the escaping test in
`src/reporters/reporters.test.ts`. Audited pages are attacker-controlled.

A SARIF reporter (for inline results in code hosts) and a JUnit reporter (for
test runners) are the obvious additions; they are listed in
[ROADMAP.md](./ROADMAP.md).

## Add a target adapter

This is how desktop, native and mobile targets get added without touching any
existing check.

1. Define a snapshot type: the serializable facts the checks will need. Look at
   `src/web/snapshot.ts` and `src/code/snapshot.ts`.
2. Write a collector that produces it from a reference.
3. Write checks with `appliesTo: ["native"]` (or whatever kind you add), typed
   to your snapshot.
4. Add the kind to `TargetKind` in `src/core/types.ts`.
5. Update `detectTarget` in `src/core/detect.ts` to recognize it, and add a
   branch in `cmdAudit` that calls your collector and runs
   `registry.forTarget("native")`.

Because checks are keyed by `appliesTo`, existing web and code checks are simply
not selected for the new kind, and new checks are simply not selected for the old
ones. The runner and the scoring engine need no changes.

### A desktop adapter, concretely

A desktop app has no DOM. The adapter would collect what is measurable from the
outside: window and control geometry via the platform accessibility API, the
rendered pixels for color and layout checks, icon assets on disk for the icon
checks, and the binary/package metadata for dependency and secret checks.
Several existing categories (color, typography by rendered pixels, content by
OCR or accessibility tree text) could then run against that snapshot. See
[ROADMAP.md](./ROADMAP.md).

## Changing the rubric

You usually do not edit code for this. Per-rule severity and weight, and whole
custom profiles, are config
([CONFIGURATION.md](./CONFIGURATION.md)). Only change `src/core/scoring.ts` if
you want different math for everyone, and document it in
[../rubric/SCORING.md](../rubric/SCORING.md), because that file is the contract.

## Before you submit

```bash
npm run typecheck   # clean
npm test            # all green
slopaudit audit .   # the tool should not flag its own new code
```

That last one matters: this project holds itself to its own rules. If a new
check flags slopaudit's own source, either the check is too loose or the source
needs fixing.
