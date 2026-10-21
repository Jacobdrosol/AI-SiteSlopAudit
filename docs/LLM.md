# The LLM review

The model layer is optional, local, and deliberately kept away from the real
grade. This document explains how it works and why it is built that way.

## Why it exists

Some slop is not measurable. A check can prove a paragraph is 14px next to a
16px one, but it cannot judge whether the copy is actually saying anything, or
whether a layout choice is weak for a specific product. A model can read a page
the way a person would. That is genuinely useful as a second opinion.

The reason it does not affect the score: a model is non-deterministic, it can
hallucinate problems, and asking a model to "rate this site" is the exact
behavior this tool exists to catch. So the model is an additional section, never
the number.

## How to run it

```bash
slopaudit models                                          # list your local models
slopaudit audit https://example.com --llm --model qwen3-coder:30b
slopaudit audit ./my-project --llm --model llama3.1:70b
slopaudit audit https://example.com --llm-only --model llama3.1:70b
```

- `--llm` runs the deterministic audit and the model review.
- `--llm-only` skips the deterministic audit and runs only the model review.
- `--model` selects the model. There is no default; you choose.
- `--llm-url` overrides the Ollama base URL (default `http://127.0.0.1:11434`).

Enable it permanently in config:

```json
{ "llm": { "enabled": true, "model": "qwen3-coder:30b" } }
```

## What the model sees

Only the deterministic result, not the raw page. The prompt contains the target,
the deterministic grade, the per-category scores, and the ranked findings, and
asks for strict JSON back:

```json
{
  "score": 0,
  "summary": "two sentences",
  "findings": [
    { "category": "...", "severity": "...", "title": "...", "detail": "...", "fix": "..." }
  ]
}
```

This is intentional. Giving the model the measured findings grounds it, so its
opinion is anchored to facts rather than a fresh, vibes-based read of the page.
It also keeps the prompt small and fast.

## How the answer is handled

The response is parsed defensively (`src/llm/ollama.ts`):

- `format: "json"` is requested, and the parser still strips markdown fences and
  finds the outermost JSON object, because models sometimes wrap it anyway.
- The score is clamped to 0-100.
- Severities and categories are validated against the known sets; anything
  unknown becomes `medium` / `code`.
- At most eight findings are kept.

If the model is unreachable, times out, or returns something unparseable, the LLM
section records the error and the deterministic report is unaffected. A failed
model review is a warning, not a failed audit.

## What it does not do

- It does not change the deterministic score or grade.
- It does not see the live page or the source; it sees the findings.
- It does not send anything off your machine. The request goes to your local
  Ollama at `127.0.0.1`.

## Reporting

In the terminal, the LLM section is labeled `LLM REVIEW (non-authoritative)` and
shows the model, its grade and score, its summary, and its findings. In the HTML
report it is a dashed-border section with the same label. In JSON it is the
`llm` key, separate from `deterministic`.

## Choosing a model

Use `slopaudit models` to see what you have. Practical notes:

- Instruction-tuned models with reliable JSON output are best. If a model
  repeatedly fails to return JSON, it will show up as an error in the section
  rather than corrupting anything.
- Larger models give better judgment but are slower. A code-oriented model tends
  to do well on the code target.
- The tool never picks a model for you, because which models exist and perform
  well is specific to the machine.

## Related future work

The model layer is also the intended backend for **context-aware suggestions**: a
future `--suggest --model <name>` mode where the model proposes per-element fixes
that cite real selectors and file lines, with a strict "cite a real target or the
suggestion is dropped" rule and no effect on the score. That is a design, not a
feature, and it is documented in [SUGGESTIONS.md](./SUGGESTIONS.md). The existing
`--llm` review is unchanged by it.
