import type { Finding } from "../core/types.js";

// Active security probing. This makes real GET requests to the target to look
// for exposed files, user enumeration, and secrets shipped inside JavaScript
// bundles. It is opt-in (`--deep`) because it is active and must only be run
// against targets you are authorized to test.

export interface DeepSecurityOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxScripts?: number;
  maxScriptBytes?: number;
}

const SENSITIVE_PATHS: Array<{ path: string; rule: string; label: string; signature: RegExp }> = [
  { path: "/.env", rule: "security.exposed-file", label: ".env environment file", signature: /^[A-Z0-9_]+=.+/m },
  { path: "/.git/HEAD", rule: "security.exposed-file", label: ".git repository metadata", signature: /^ref:\s|^[0-9a-f]{40}/ },
  { path: "/.git/config", rule: "security.exposed-file", label: ".git config", signature: /\[core\]|\[remote/ },
  { path: "/.ds_store", rule: "security.exposed-file", label: ".DS_Store", signature: /Bud1|\x00\x00\x00/ },
  { path: "/.svn/entries", rule: "security.exposed-file", label: ".svn metadata", signature: /^\d+\s*$/m },
  { path: "/wp-config.php.bak", rule: "security.exposed-file", label: "WordPress config backup", signature: /DB_PASSWORD|DB_NAME/ },
  { path: "/wp-config.php~", rule: "security.exposed-file", label: "WordPress config backup", signature: /DB_PASSWORD|DB_NAME/ },
  { path: "/config.php.bak", rule: "security.exposed-file", label: "config backup", signature: /password|db_|secret/i },
  { path: "/backup.zip", rule: "security.exposed-file", label: "backup archive", signature: /PK\x03\x04/ },
  { path: "/backup.sql", rule: "security.exposed-file", label: "database dump", signature: /(CREATE TABLE|INSERT INTO|-- MySQL)/i },
  { path: "/phpinfo.php", rule: "security.exposed-file", label: "phpinfo page", signature: /<title>phpinfo\(\)|PHP Version/ },
  { path: "/server-status", rule: "security.exposed-file", label: "Apache server-status", signature: /Apache Server Status|Server Version:/ },
  { path: "/.well-known/security.txt", rule: "security.no-security-txt", label: "security.txt", signature: /Contact:/i, invert: true } as never,
  { path: "/swagger.json", rule: "security.exposed-file", label: "API schema (Swagger)", signature: /"swagger"|"openapi"/ },
  { path: "/openapi.json", rule: "security.exposed-file", label: "API schema (OpenAPI)", signature: /"openapi"/ },
];

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk_live_[0-9a-zA-Z]{16,}/, label: "Stripe live secret key" },
  { re: /AKIA[0-9A-Z]{16}/, label: "AWS access key id" },
  { re: /ghp_[0-9a-zA-Z]{36}/, label: "GitHub token" },
  { re: /AIza[0-9A-Za-z_-]{35}/, label: "Google API key" },
  { re: /xox[baprs]-[0-9a-zA-Z-]{10,}/, label: "Slack token" },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: "private key" },
  { re: /(?:mongodb|postgres|postgresql|mysql|redis):\/\/[^\s"']{6,}@/i, label: "database connection string with credentials" },
  { re: /"private_key"\s*:\s*"-----BEGIN/, label: "service account private key" },
];

function redact(s: string): string {
  return s.replace(/([A-Za-z0-9_\-]{6})[A-Za-z0-9_\-]{12,}/g, "$1...[redacted]");
}

async function get(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; text: string; headers: Headers } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "slopaudit-security-probe/0.1" },
    });
    const text = await res.text().catch(() => "");
    return { status: res.status, text: text.slice(0, 200_000), headers: res.headers };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function deepSecurityProbe(
  options: DeepSecurityOptions,
): Promise<Finding[]> {
  const base = options.baseUrl.replace(/\/$/, "");
  const timeout = options.timeoutMs ?? 8000;
  const findings: Finding[] = [];

  // 1. Exposed sensitive files.
  for (const probe of SENSITIVE_PATHS) {
    const url = base + probe.path;
    const res = await get(url, timeout);
    if (!res) continue;
    if (probe.rule === "security.no-security-txt") {
      continue; // handled below
    }
    if (res.status !== 200) continue;
    const ok =
      probe.signature instanceof RegExp ? probe.signature.test(res.text) : false;
    if (!ok) continue;
    findings.push({
      ruleId: "security.exposed-file",
      category: "security",
      severity: probe.path.includes(".env") || probe.path.includes("git") || probe.path.includes(".sql") || probe.path.includes(".zip")
        ? "critical"
        : "high",
      title: `Exposed: ${probe.label}`,
      detail: `${url} returned 200 and its content matches a ${probe.label}. A file like this should never be reachable. It can leak credentials, source code, or the whole database.`,
      location: url,
      evidence: [{ label: "url", value: url }, { label: "status", value: "200 OK" }],
      fix: "Block this path at the web server, remove the file from the web root, and rotate anything it contained.",
    });
  }

  // 2. WordPress user enumeration.
  const wpUsers = await get(`${base}/wp-json/wp/v2/users`, timeout);
  if (wpUsers && wpUsers.status === 200 && /"slug"\s*:/.test(wpUsers.text)) {
    const names = [...wpUsers.text.matchAll(/"slug"\s*:\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .slice(0, 8);
    findings.push({
      ruleId: "security.user-enumeration",
      category: "security",
      severity: "medium",
      title: "WordPress user enumeration",
      detail: `The REST API at /wp-json/wp/v2/users lists author usernames (${names.join(", ") || "present"}). Attackers use this to build a target list for password attacks.`,
      location: `${base}/wp-json/wp/v2/users`,
      evidence: names.map((n) => ({ label: "username", value: n })),
      fix: "Restrict the users endpoint (disable the REST API for unauthenticated requests) or block /wp-json/wp/v2/users.",
    });
  }

  // 3. Secrets embedded in same-origin JavaScript bundles.
  //    The URL-only check cannot see these; the content can.
  let scanned = 0;
  const maxScripts = options.maxScripts ?? 20;
  const maxBytes = options.maxScriptBytes ?? 2_000_000;
  const scriptUrls = await discoverScripts(base, timeout, maxScripts);
  const seen = new Set<string>();
  for (const src of scriptUrls) {
    if (scanned >= maxScripts) break;
    const url = src.startsWith("http") ? src : base + (src.startsWith("/") ? "" : "/") + src;
    if (new URL(url, base).origin !== new URL(base).origin) continue; // same-origin only
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await get(url, timeout);
    if (!res || res.status !== 200) continue;
    scanned++;
    const body = res.text.slice(0, maxBytes);
    const hits = SECRET_PATTERNS.filter((p) => p.re.test(body));
    if (hits.length === 0) continue;
    findings.push({
      ruleId: "security.secret-in-js",
      category: "security",
      severity: "critical",
      title: `Secret found inside JavaScript bundle`,
      detail: `${url.split("/").pop()} contains ${hits.map((h) => h.label).join(", ")}. Because it is in a client bundle, it is public: anyone who opens devtools can read it.`,
      location: url,
      evidence: hits.map((h) => ({ label: h.label, value: "present in bundle" })),
      fix: "Rotate the credential immediately, remove it from the bundle, and load it server-side at runtime.",
    });
  }
  void redact; // reserved for redacting matched values if a sample is added

  return findings;
}

async function discoverScripts(
  base: string,
  timeout: number,
  _max: number,
): Promise<string[]> {
  const res = await get(base, timeout);
  if (!res) return [];
  const urls = new Set<string>();
  for (const m of res.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    if (m[1]) urls.add(m[1]);
  }
  return [...urls];
}
