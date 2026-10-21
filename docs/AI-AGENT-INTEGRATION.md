# Using slopaudit in an AI coding session

slopaudit is a deterministic CLI. It was built to be driven by an AI coding
agent in a loop: the agent writes code, runs slopaudit, reads the findings, and
fixes them before it calls the work done. This document is about the wiring.

For the CLI flags, JSON shape and exit codes this relies on, see
[RUNNING-AND-CLI-CONTRACT.md](./RUNNING-AND-CLI-CONTRACT.md).

There are two integration shapes, and they are complementary:

1. **The audit runs and its findings are fed back into the model's context.**
   This is what makes the model self-correct. It is the important half.
2. **The audit is exposed as a callable tool** the model can invoke on demand.

You want both. The first catches work the model would otherwise ship; the second
lets the model check anything, any time.

## What the agent needs to know

Regardless of host, an integration needs to do four things:

1. **Invoke** `bin/slopaudit.mjs audit <target> --format json` and read stdout.
   Never vendor a copy of the tool: call it in place so the agent always uses the
   current checks. (This is the whole reason updates to slopaudit "just work".)
2. **Choose the target correctly.** This is the most common mistake:
   - `code` target (`audit <path>`) runs **24 checks** - hygiene, secrets,
     dependencies, code quality. It sees no design. Add `--scan` to also run the
     external analyzers (npm audit, semgrep, osv-scanner, trivy, gitleaks,
     checkov, bandit, pip-audit) that are installed.
   - `web` target (`audit <url>`) runs **51 checks**, including the design
     ones: fonts, gradients, layout, contrast, accessibility.
   - `desktop` target (`audit <path> --type desktop`, or auto-detected for a
     .NET/XAML/Avalonia project) runs **11 checks** for desktop slop: unwired
     controls, unlabeled controls, missing pointer cursors, placeholder copy,
     literal colours and fonts, fixed/non-resizable layout, unvirtualized lists,
     blocking UI-thread calls, oversized views, and charts without axis labels.
   - `native` target (`audit <path> --type native`, or auto-detected for a
     CMake/Qt/.vcxproj/.uproject project) runs **23 checks** for C/C++ crash and
     slop risks: unchecked HRESULT/VkResult, missing resize/swapchain recreation,
     unhandled device loss, unsafe C functions, shell execution, hard-coded
     credentials, detached threads, UI-thread sleeps, self-delete, fixed windows,
     missing pointer cursors, axis-less charts, placeholder copy, colour/path
     literals, missing tests/sanitizers/warnings. Add `--smoke <exe>` to launch
     the built app and resize it through four sizes.
     (24 + 51 + 11 + 23 = the full 109-check registry.)
   So: always run a code audit on the project; additionally run a **web** audit
   against a running dev-server URL when one exists, because that is what catches
   visual slop. If only one can run, run the web audit for anything user-facing.
3. **Summarize for the model, do not dump.** Return the score, grade, and the
   findings with their `title`, `location` and `fix`. Keep the measured evidence
   (`"#aab0bd on #ffffff renders 2.18:1"`) - it is the reason to trust the tool.
   The JSON report is the full contract; see `src/core/report.ts`.
4. **Decide when to run it.** Running on every keystroke wastes time; never
   running it wastes the tool. The policy that works: run after a *pass* of
   work. Two cheap signals - the request named a build/feature/page/refactor, or
   the session has touched several source files - arm it, then debounce so it
   fires once edits pause. A one-line fix does not trigger it.

## The reference implementation: opencode

The canonical integration lives at
`~/.config/opencode/plugin/slop-guard.ts`. Read it first; it is short and it
implements all four points above. It provides:

- a `slop_audit` tool (the on-demand path),
- an automatic guard that debounces after edits, derives the project from the
  files being edited, finds that project's own running dev server by matching
  the process command line that owns the listening port, runs the code audit
  always (`--scan` opt-in via `SLOP_GUARD_SCAN=1`) and the web audit when a
  server is up, dedupes findings, and appends them to the model's next tool
  result,
- environment controls: `SLOPAUDIT_HOME` (where the tool lives),
  `SLOP_GUARD_DISABLE` (off switch), `SLOP_GUARD_SCAN` (external analyzers),
  `SLOP_GUARD_MIN_FILES`, `SLOP_GUARD_DEBOUNCE_MS`, `SLOP_GUARD_URL`.

The key mechanism, and the one to reproduce elsewhere, is **appending findings to
a tool result the model is about to read**. In opencode that is the
`tool.execute.after` hook's `output.output`. Every host has some equivalent; the
goal is to put the findings where the model already looks, not in a side channel
it ignores.

## Porting to another host

The tool itself does not change. Only the glue does. Below, "tool call" means
running `bin/slopaudit.mjs` and parsing its JSON.

### OpenAI Codex / Codex CLI

Codex supports **MCP servers** and a project `AGENTS.md`.

- **MCP route (recommended).** Wrap the CLI as a tiny MCP server exposing one
  tool, `slop_audit(target, detail, minSeverity, categories, profile)`, that
  spawns `bin/slopaudit.mjs audit <target> --format json` and returns the
  formatted findings. Register that server in Codex's MCP config. The
  server can be ~80 lines: it only needs to shell out and shape the report. The
  formatting logic is already written in `slop-guard.ts`; copy `renderFindings`
  and `renderSummary`.
- **Instruction route.** Add to the project `AGENTS.md`: "After completing a
  substantial pass, run `slopaudit audit <url|.>` and resolve the findings before
  declaring the task done." This covers the model-driven half. Pair it with the
  MCP tool so the model has something to call.

Codex does not have an "append to tool output" hook, so the feedback half is
model-driven: the agent must be instructed to run it, and the MCP tool gives it
the means.

### Claude (Claude Code, or the Claude API)

- **Claude Code** has MCP servers, hooks, and a `CLAUDE.md`. Same plan as Codex:
  expose `slop_audit` over MCP, and put the "run it after a pass" instruction in
  `CLAUDE.md`. Claude Code's **PostToolUse hook** is the closest match to
  opencode's `tool.execute.after`: a script that runs after an edit, debounces,
  and, if the audit finds new issues, prints them to a place the model reads.
  Hook output on stdout is surfaced to the model, so a hook can `cat` the
  formatted findings.
- **Raw Claude API.** No hooks. Wrap the whole loop yourself: after each
  assistant turn that contained an edit, run the tool, and inject its output as
  a `tool_result` (or a synthetic user turn) before the next model call. The
  rule is unchanged - put findings in the transcript, not out of band.

### Google Gemini / Vertex AI

- **Gemini CLI** supports extensions and MCP. Expose `slop_audit` over MCP, and
  put the pass-level instruction in the project's context file (`GEMINI.md` or
  the equivalent).
- **Vertex AI (console or SDK).** Function calling is the mechanism. Declare a
  `slop_audit` function whose parameters mirror the CLI flags; implement it as a
  handler that runs the CLI and returns the JSON (or the formatted text as the
  function response). The model will call it; the response becomes part of the
  conversation. Vertex has no post-tool hook, so the "run it automatically"
  behavior is an instruction plus your orchestration deciding when to call the
  function on the model's behalf.

### A custom opencode clone, or any agent framework

The pattern is host-agnostic. Implement three seams:

1. **A tool/function** that shells out to `bin/slopaudit.mjs` and returns
   findings. Reuse the formatting from `slop-guard.ts`.
2. **A post-edit hook** that tracks changed files and a "is this a build" signal,
   debounces, runs the tool, and injects results into the next message the model
   reads.
3. **A config point** for `SLOPAUDIT_HOME`, so the tool can live anywhere and be
   updated independently of the agent.

If your framework has neither hooks nor tool calling, the fallback is
orchestration: after every turn that changed files, run the tool and prepend its
output to the next prompt.

## CI and pre-commit

The tool is designed to gate too, not only advise:

```bash
slopaudit audit https://staging.example.com --profile strict --fail-under 80
```

Exit code is non-zero below the threshold, so it drops into CI as-is. A
pre-commit or pre-push hook can run a code audit on the staged tree the same way.
The security counterpart (`security-guard`) already blocks staging secrets; a
slop `--fail-under` gate is the design-time equivalent.

## Keeping the integration current

Because the integration calls the tool in place, a new check, a new profile, or a
retuned rubric is picked up on the next run with no change to the glue. The only
things that would require touching an integration are changes to the **CLI
surface** (a new required flag) or the **JSON report shape** (see
`src/core/report.ts`). When either changes, update this document and the
reference plugin together; they are the contract.
