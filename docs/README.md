# slopaudit documentation

This folder explains how the tool works, how to use it, how to extend it, and
where it is going. Start with the one that matches what you need.

| Document | Read it for |
| --- | --- |
| [USAGE.md](./USAGE.md) | Every command and flag, with real examples |
| [RUNNING-AND-CLI-CONTRACT.md](./RUNNING-AND-CLI-CONTRACT.md) | How to run the CLI yourself, and the JSON/exit-code contract integrations rely on |
| [CHECKS.md](./CHECKS.md) | What each of the 109 checks detects and how |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the pieces fit together and why |
| [EXTENDING.md](./EXTENDING.md) | How to add a check, a reporter, or an adapter |
| [AI-AGENT-INTEGRATION.md](./AI-AGENT-INTEGRATION.md) | Wiring slopaudit into an AI coding session (opencode, Codex, Claude, Gemini) |
| [CONFIGURATION.md](./CONFIGURATION.md) | Config file, profiles, and tuning the rubric |
| [LLM.md](./LLM.md) | The optional local model layer |
| [SUGGESTIONS.md](./SUGGESTIONS.md) | Future: context-aware, per-element fixes |
| [IMAGERY-AND-SECURITY.md](./IMAGERY-AND-SECURITY.md) | Image checks, the vision-model tier, and `--deep` security probing |
| [GUARDRAILS.md](./GUARDRAILS.md) | Server/desktop/native/mobile coverage and the free vulnerability-analyzer orchestration |
| [IMPROVEMENTS.md](./IMPROVEMENTS.md) | Known weaknesses and honest gaps |
| [ROADMAP.md](./ROADMAP.md) | Planned targets and features |
| [../rubric/SCORING.md](../rubric/SCORING.md) | The scoring contract in exact numbers |

## The one-paragraph version

slopaudit measures a website, a codebase, a desktop app or a native C/C++ app
and produces a reproducible grade for how much it reads as careless,
machine-generated work: default typography, the
indigo-to-blue gradient, the hero-over-three-equal-cards layout, emoji in copy,
mixed paragraph sizes, missing contrast, unlabeled controls, missing security
headers, secrets in source. Every finding comes from something the tool
actually measured, so the grade is the same every run. An optional local model
review runs alongside it as a clearly separate, non-authoritative second
opinion that never touches the deterministic grade.
