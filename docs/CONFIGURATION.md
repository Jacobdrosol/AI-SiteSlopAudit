# Configuration

slopaudit loads `slopaudit.config.json` from the current directory automatically.
`slopaudit init` writes a starter file. `--config <path>` points at a specific
one. Filenames checked, in order: `slopaudit.config.json`, `.slopauditrc.json`,
`.slopauditrc`.

Invalid config is rejected with exit code 2 and a message naming the problem. It
never silently changes your grade.

## Full surface

```json
{
  "profile": "default",

  "llm": {
    "enabled": false,
    "model": "qwen3-coder:30b",
    "baseUrl": "http://127.0.0.1:11434"
  },

  "rules": {
    "color.purple-blue-gradient": { "severity": "high" },
    "layout.uniform-padding": { "enabled": false },
    "code.duplication": { "weight": 0.5 }
  },

  "profiles": {
    "my-house-style": {
      "severityPenalties": { "critical": 50, "high": 25, "medium": 10, "low": 4, "info": 1 },
      "categoryWeights": { "security": 2.0, "content": 1.5 },
      "ruleDecay": 0.7,
      "worstCategoryWeight": 0.4,
      "breadthPenalty": 0.1
    }
  },

  "web": {
    "viewports": [1440, 768, 375],
    "timeoutMs": 30000,
    "fullPage": false,
    "storageState": ".slopaudit-auth.json"
  },

  "code": {
    "maxFiles": 8000,
    "include": ["src"]
  },

  "failUnder": 70
}
```

Every field is optional.

## `profile`

Selects the built-in profile to start from. Built-ins: `default`, `strict`,
`marketing-site`, `a11y-first`, `lenient`. `--profile` on the command line
overrides this.

## `rules`

Per-rule overrides, keyed by rule id (see `slopaudit checks` for the list).

| Key | Type | Effect |
| --- | --- | --- |
| `severity` | severity name | Relabels the finding and uses that severity's penalty. |
| `weight` | number >= 0 | Multiplies the penalty. `0` counts the finding but never affects the score. |
| `enabled` | boolean | `false` skips the rule entirely. Same as `--disable`. |

```json
"rules": {
  "type.default-font": { "severity": "low" },
  "layout.uniform-padding": { "enabled": false },
  "code.todo-markers": { "weight": 0 }
}
```

## `profiles` and custom rubrics

You can define your own profile. Any field you set overrides the `profile` you
start from; anything you omit is inherited.

```json
{
  "profile": "my-house-style",
  "profiles": {
    "my-house-style": {
      "severityPenalties": { "critical": 50, "high": 25 },
      "categoryWeights": { "security": 2.0, "components": 0.5 },
      "ruleDecay": 0.7
    }
  }
}
```

Partial `severityPenalties` and `categoryWeights` merge with the base profile, so
you only write the values you want to change. Unknown categories or severities
are rejected. `ruleDecay` is 0-1: higher means repeats are punished more.

Two keys control how harsh the overall score is:

| Key | Default | Meaning |
| --- | --- | --- |
| `worstCategoryWeight` | 0 | Reserved: how much the single worst category drags the score. 0 disables it. |
| `breadthPenalty` | 0 | Reserved: score removed in proportion to how many categories have findings. 0 disables it. |
| `slopWeights` | built-in table | Per-rule slop points. `{ "layout.motif-stacking": 14 }` overrides one rule. |
| `instanceDecay` | 0.5 | Fraction of a rule's weight added for each repeat after the first. |

The score is **additive**: `quality = 100 - SUM(ruleWeight * confidence * repeatFactor)`.
A rule's weight is how diagnostic it is of slop, not how severe the bug is, so
a missing header is worth a fraction of a point while a repeated motif is worth
twelve. See [../rubric/SCORING.md](../rubric/SCORING.md) for the full model and
the default weight table.

## `web`

| Key | Meaning |
| --- | --- |
| `viewports` | Widths to test, in px. |
| `timeoutMs` | Page navigation timeout. |
| `fullPage` | Capture full-page screenshots instead of viewport. |
| `storageState` | Path to a saved login session, for authenticated pages. |

Overridable with `--viewports`, `--timeout`, `--full-page`, `--storage-state`.

## `code`

| Key | Meaning |
| --- | --- |
| `maxFiles` | Cap on files scanned. |
| `include` | Only scan paths or extensions containing these substrings. |

Overridable with `--max-files`, `--include`.

## `llm`

| Key | Meaning |
| --- | --- |
| `enabled` | Run the model review for every audit without passing `--llm`. |
| `model` | Model name. Required for the review to run. |
| `baseUrl` | Ollama base URL. |

Overridable with `--model`, `--llm-url`.

## `failUnder`

Default threshold for the exit code. `--fail-under` overrides it.

## Precedence

Command-line flags beat the config file. Config `rules` beat profile defaults.
A profile's explicit values beat the profile it was based on. The rubric is
resolved once, before any check runs.
