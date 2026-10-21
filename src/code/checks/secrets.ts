import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { CodeSnapshot } from "../snapshot.js";

interface SecretPattern {
  id: string;
  label: string;
  re: RegExp;
  severity: "critical" | "high";
}

const SECRET_PATTERNS: SecretPattern[] = [
  { id: "aws-key", label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/, severity: "critical" },
  { id: "stripe-live", label: "Stripe live secret key", re: /\bsk_live_[0-9a-zA-Z]{16,}\b/, severity: "critical" },
  { id: "github-pat", label: "GitHub token", re: /\bghp_[0-9a-zA-Z]{36}\b/, severity: "critical" },
  { id: "github-oauth", label: "GitHub OAuth token", re: /\bgho_[0-9a-zA-Z]{36}\b/, severity: "critical" },
  { id: "slack-token", label: "Slack token", re: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/, severity: "critical" },
  { id: "google-api", label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: "high" },
  { id: "private-key", label: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, severity: "critical" },
  { id: "jwt", label: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, severity: "high" },
  { id: "npm-token", label: "npm access token", re: /\bnpm_[0-9a-zA-Z]{36}\b/, severity: "critical" },
  { id: "openai-key", label: "OpenAI API key", re: /\bsk-[A-Za-z0-9]{20,}\b/, severity: "high" },
  { id: "generic-secret", label: 'hard-coded secret assignment', re: /\b(?:api[_-]?key|apikey|secret|password|passwd|pwd|token)\s*[:=]\s*["'][A-Za-z0-9_\-+/]{16,}["']/i, severity: "high" },
];

const FALSE_POSITIVE_HINTS = [
  "example", "placeholder", "your_", "xxxx", "redacted", "dummy", "test-",
  "sample", "fake", "fakekey", "notreal", "process.env", "os.environ",
  "getenv", "import.meta.env", "ENV[", "%s", "${",
];

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return FALSE_POSITIVE_HINTS.some((h) => lower.includes(h));
}

function redact(line: string, match: string): string {
  if (match.length < 8) return line.replace(match, "[redacted]");
  const head = match.slice(0, 4);
  const tail = match.slice(-2);
  return line.replace(match, `${head}...[redacted]...${tail}`);
}

export const secretChecks = [
  defineCheck<CodeSnapshot>({
    id: "security.hardcoded-secrets",
    category: "security",
    title: "Hard-coded secrets in source",
    description:
      "API keys, tokens or private keys committed into source files.",
    defaultSeverity: "critical",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      for (const f of data.files) {
        if (f.bytes > 500_000) continue;
        const lines = f.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.length > 500) continue;
          for (const p of SECRET_PATTERNS) {
            const m = line.match(p.re);
            if (!m) continue;
            if (looksLikePlaceholder(line)) continue;
            findings.push({
              ruleId: "security.hardcoded-secrets",
              category: "security",
              severity: p.severity,
              title: `${p.label} found in source`,
              detail: `A value matching "${p.label}" appears at ${f.relPath}:${i + 1}. If this is real it must be rotated now; committing a secret to git means it is compromised even after you delete it.`,
              location: `${f.relPath}:${i + 1}`,
              evidence: [
                {
                  label: f.relPath,
                  file: f.relPath,
                  line: i + 1,
                  value: redact(line.trim(), m[0]).slice(0, 80),
                },
              ],
              fix: "Rotate the credential, load it from an environment variable or secret store at runtime, and add the file pattern to .gitignore.",
            });
            break;
          }
          if (findings.length >= 20) break;
        }
        if (findings.length >= 20) break;
      }
      return findings;
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.env-committed",
    category: "security",
    title: "Environment file present in the tree",
    description:
      "A .env file exists (and may be tracked), which is the usual way secrets leak.",
    defaultSeverity: "high",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const envFiles = data.files.filter((f) => {
        const base = f.relPath.split("/").pop() ?? "";
        const isEnv = base === ".env" || /^\.env\./.test(base);
        const isTemplate = base.endsWith(".example") || base.endsWith(".sample") || base.endsWith(".template");
        return isEnv && !isTemplate;
      });
      const tracked = data.git.trackedSecretCandidates;
      const findings: Finding[] = [];
      if (envFiles.length > 0 && !data.git.hasGitignore) {
        findings.push({
          ruleId: "security.env-committed",
          category: "security",
          severity: "high",
          title: ".env present with no .gitignore",
          detail: `${envFiles.length} environment file(s) found (${envFiles
            .slice(0, 3)
            .map((f) => f.relPath)
            .join(", ")}) and the repo has no .gitignore. This is how secrets get pushed.`,
          evidence: envFiles.slice(0, 4).map((f) => ({ label: f.relPath, file: f.relPath })),
          fix: "Add .gitignore with .env, move values to a secret store, and rotate anything already committed.",
        });
      }
      if (tracked.length > 0) {
        findings.push({
          ruleId: "security.env-committed",
          category: "security",
          severity: "critical",
          title: `${tracked.length} secret-like file(s) tracked by git`,
          detail: `git tracks: ${tracked.slice(0, 5).join(", ")}. Tracked keys and env files are already in history and must be treated as compromised.`,
          evidence: tracked.slice(0, 6).map((t) => ({ label: t, file: t })),
          fix: "Remove them from tracking, purge history (git filter-repo), rotate every exposed credential.",
        });
      }
      return findings;
    },
  }),
];
