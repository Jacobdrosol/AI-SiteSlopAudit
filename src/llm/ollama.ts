import type { AuditReport, LlmFinding, LlmResult } from "../core/report.js";
import { toGrade } from "../core/scoring.js";

export interface OllamaOptions {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  temperature?: number;
  numPredict?: number;
}

const DEFAULT_BASE = "http://127.0.0.1:11434";

export async function listOllamaModels(
  baseUrl = DEFAULT_BASE,
): Promise<Array<{ name: string; size: number }>> {
  const res = await fetch(`${baseUrl}/api/tags`);
  if (!res.ok) throw new Error(`Ollama tags failed: ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name: string; size: number }> };
  return data.models ?? [];
}

function buildPrompt(report: AuditReport): string {
  const d = report.deterministic;
  const findings = d.topFindings
    .map(
      (f) =>
        `- [${f.severity}] (${f.category}) ${f.title}: ${f.detail}${f.location ? ` @ ${f.location}` : ""}`,
    )
    .join("\n");
  const categories = d.categories
    .map((c) => `- ${c.category}: ${c.score.toFixed(1)}/100, ${c.findings} findings`)
    .join("\n");

  return `You are a strict UI and code quality reviewer. You are given the deterministic results of an automated "slop audit" of a product. Judge how much it reads as careless, AI-generated work with weak security and no design decisions.

Target: ${report.target.kind} — ${report.target.ref}
Deterministic grade: ${d.grade} (${d.score}/100)

Category scores:
${categories}

Deterministic findings:
${findings || "(none)"}

Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "score": <integer 0-100>,
  "summary": "<two sentences, plain and specific, no marketing voice>",
  "findings": [
    { "category": "<layout|typography|color|content|components|security|code|dependencies|performance>",
      "severity": "<critical|high|medium|low|info>",
      "title": "<short>",
      "detail": "<one or two sentences>",
      "fix": "<one bounded change>" }
  ]
}
Give at most 6 findings. Do not invent facts not supported by the input. Do not use emojis.`;
}

interface RawLlm {
  score?: unknown;
  summary?: unknown;
  findings?: unknown;
}

function extractJson(text: string): RawLlm {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("model did not return JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as RawLlm;
}

function coerceFindings(raw: unknown): LlmFinding[] {
  if (!Array.isArray(raw)) return [];
  const valid: LlmFinding["severity"][] = ["critical", "high", "medium", "low", "info"];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .slice(0, 8)
    .map((f) => {
      const severity = valid.includes(f.severity as LlmFinding["severity"])
        ? (f.severity as LlmFinding["severity"])
        : "medium";
      return {
        category: String(f.category ?? "code"),
        severity,
        title: String(f.title ?? "Untitled finding"),
        detail: String(f.detail ?? ""),
        fix: f.fix ? String(f.fix) : undefined,
      };
    });
}

export async function runOllamaReview(
  report: AuditReport,
  options: OllamaOptions,
): Promise<LlmResult> {
  const base = options.baseUrl ?? DEFAULT_BASE;
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120000);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        stream: false,
        format: "json",
        options: {
          temperature: options.temperature ?? 0.2,
          num_predict: options.numPredict ?? 1200,
        },
        messages: [
          { role: "system", content: "You are a terse, skeptical quality reviewer. Output only valid JSON." },
          { role: "user", content: buildPrompt(report) },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        enabled: true,
        model: options.model,
        score: null,
        grade: null,
        summary: null,
        findings: [],
        error: `Ollama responded ${res.status}: ${body.slice(0, 200)}`,
        durationMs: Date.now() - started,
      };
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content ?? "";
    const parsed = extractJson(content);
    const rawScore = Number(parsed.score);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : null;
    return {
      enabled: true,
      model: options.model,
      score,
      grade: score === null ? null : toGrade(score),
      summary: parsed.summary ? String(parsed.summary) : null,
      findings: coerceFindings(parsed.findings),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      enabled: true,
      model: options.model,
      score: null,
      grade: null,
      summary: null,
      findings: [],
      error: message.includes("aborted") ? "timed out" : message,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}
