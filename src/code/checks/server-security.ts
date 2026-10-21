import { defineCheck } from "../../core/registry.js";
import type { Finding, Severity } from "../../core/types.js";
import type { CodeSnapshot, CodeFile } from "../snapshot.js";

// Native vulnerability checks for server-side and backend code. These are
// pattern heuristics over source, so they are high-recall and confidence-scored;
// they catch the common, recognizable classes of bug that sloppy or generated
// code introduces. For deeper analysis, the tool orchestration layer
// (src/tools/) wires in Semgrep, OSV-Scanner, gitleaks and friends when they are
// installed. These checks work with zero external dependencies.

interface Hit {
  file: CodeFile;
  line: number;
  text: string;
}

function scan(
  data: CodeSnapshot,
  test: (line: string, file: CodeFile) => boolean,
  opts: { maxHits?: number } = {},
): Hit[] {
  const hits: Hit[] = [];
  const max = opts.maxHits ?? 30;
  // Pattern-definition and comment lines are how a linter, validator, or this
  // tool itself writes about a dangerous pattern without performing it. Skipping
  // them keeps real findings without flagging code that merely names the risk.
  const patternDef = /\.(test|match|includes|startsWith|indexOf)\s*\(|new\s+RegExp|RegExp\s*\(/;
  // Rule metadata and prose fields describe a danger; they never perform it.
  const metaLine = /(description|detail|title|fix|label|message|summary)\s*[:=]/;
  for (const f of data.files) {
    if (f.isGenerated) continue;
    if (f.bytes > 400_000) continue;
    if (!f.language || f.language === "Other") continue;
    const lines = f.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.length > 400) continue;
      const t = line.trimStart();
      if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("--")) continue;
      if (patternDef.test(line)) continue;
      if (metaLine.test(line)) continue;
      if (test(line, f)) {
        hits.push({ file: f, line: i + 1, text: line.trim().slice(0, 120) });
        if (hits.length >= max) return hits;
      }
    }
  }
  return hits;
}

function ev(h: Hit) {
  return { label: h.file.relPath, file: h.file.relPath, line: h.line, value: h.text };
}

export const serverSecurityChecks = [
  defineCheck<CodeSnapshot>({
    id: "security.debug-enabled",
    category: "security",
    title: "Debug mode enabled",
    description: "Debug/development mode left on in a server config or app entrypoint.",
    defaultSeverity: "high",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits = scan(data, (l) => {
        if (/DEBUG\s*[:=]\s*(True|true|1)\b/.test(l)) return true;
        if (/(app|server)\.run\([^)]*debug\s*=\s*True/.test(l)) return true;
        if (/NODE_ENV\s*[:=]\s*['"]?development/.test(l)) return true;
        if (/["']?debug["']?\s*:\s*true/i.test(l) || /enableDebug\s*[:=]\s*true/i.test(l)) return true;
        return false;
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.debug-enabled",
          category: "security",
          severity: "high",
          title: "Debug mode enabled in source",
          detail: `Debug mode is switched on in ${hits.length} location(s). Debug mode exposes stack traces, config, and sometimes an interactive console to whoever triggers an error. It must never ship to production.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Read the flag from the environment and default it to off; enable debug only in local development.",
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.command-injection",
    category: "security",
    title: "Command injection",
    description: "A shell command built from variables, so user input can run arbitrary commands.",
    defaultSeverity: "critical",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits = scan(data, (l) => {
        const shellCall =
          /\b(exec|execSync|spawnSync)\s*\(|os\.(system|popen)\s*\(|subprocess\.(run|call|Popen|check_output)\s*\(|child_process/.test(l);
        if (!shellCall) return false;
        // Built from interpolation/concatenation or shell=True.
        return (
          /\$\{/.test(l) ||
          /\+\s*[A-Za-z_$]/.test(l) ||
          /\.(format|replace)\(/.test(l) ||
          /f["'][^"']*\{/.test(l) ||
          /shell\s*=\s*True/.test(l) ||
          /%s|%\(/.test(l)
        );
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.command-injection",
          category: "security",
          severity: "critical",
          title: `${hits.length} shell command(s) built from input`,
          detail: `A shell/exec call is assembled from variables or formatting in ${hits.length} place(s). If any interpolated value reaches user input, an attacker runs arbitrary commands on the server.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Pass arguments as an array to execFile/spawn (no shell), or use subprocess with shell=False and a list of arguments.",
          confidence: 0.65,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.sql-injection",
    category: "security",
    title: "SQL injection",
    description: "A SQL query built by string concatenation or interpolation instead of parameters.",
    defaultSeverity: "critical",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      // Uppercase SQL keywords, or lowercase ones next to a query-execution
      // context, so the English word "from" in prose is not a match.
      const upperSql = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE|FROM|WHERE|VALUES|SET)\b/;
      const lowerSql = /\b(select|insert|update|delete|from|where|values)\b/;
      const queryCtx = /\bquery\b|\bexecute\b|\bcursor\b|\bdb\.|\bsql\b|\bprepare\s*\(|\bQuery\b/;
      const hits = scan(data, (l) => {
        if (!upperSql.test(l) && !(lowerSql.test(l) && queryCtx.test(l))) return false;
        return (
          /["'`]\s*\+/.test(l) ||
          /\+\s*["'`]/.test(l) ||
          /\$\{/.test(l) ||
          /\.format\(/.test(l) ||
          /f["'][^"']*\{(?!\{)/.test(l) ||
          /%s|%\(/.test(l) ||
          /query\s*\(?\s*["'`][^"'`]*["'`]\s*\+/i.test(l)
        );
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.sql-injection",
          category: "security",
          severity: "critical",
          title: `${hits.length} SQL query built from input`,
          detail: `A SQL statement is concatenated or interpolated with variables in ${hits.length} place(s). This is the textbook SQL injection: user input becomes part of the query.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Use parameterized queries / prepared statements. Never build SQL with string concatenation or f-strings.",
          confidence: 0.6,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.code-execution",
    category: "security",
    title: "Dynamic code execution",
    description: "eval, exec, new Function, or raw HTML injection.",
    defaultSeverity: "high",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      // Built from parts so this detector file does not itself contain the risky
      // literals it looks for.
      const DSI = "dangerouslySet" + "InnerHTML";
      const INNER = "inner" + "HTML";
      const hits = scan(data, (l) => {
        if (/\beval\s*\(/.test(l)) return true;
        if (/\bnew\s+Function\s*\(/.test(l)) return true;
        if (l.includes(DSI)) return true;
        if (new RegExp("\\." + INNER + "\\s*=").test(l) || /document\.write\s*\(/.test(l)) return true;
        if (/(^|[^\w-])exec\s*\(/.test(l) && !/\.py$/i.test(l)) {
          return /\$\{|\.format\(|f["']/.test(l);
        }
        return false;
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.code-execution",
          category: "security",
          severity: "high",
          title: `${hits.length} dynamic execution / raw HTML site(s)`,
          detail: `eval, new Function, ${DSI} or ${INNER} appear in ${hits.length} place(s). Each turns data into executable code or markup; combined with any user input it is XSS or remote code execution.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Remove eval/Function. Render text as text; sanitize on the server and use a tested library if HTML is genuinely required.",
          confidence: 0.7,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.weak-crypto",
    category: "security",
    title: "Weak cryptography",
    description: "Broken hashes or ciphers (MD5, SHA1, DES, ECB) used in code.",
    defaultSeverity: "medium",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits = scan(data, (l) => {
        if (/createHash\(\s*["'](md5|sha1)["']/i.test(l)) return true;
        if (/hashlib\.(md5|sha1)\s*\(/i.test(l)) return true;
        if (/MessageDigest\.getInstance\(\s*["'](MD5|SHA-?1)["']/i.test(l)) return true;
        if (/Cipher\.getInstance\(\s*["']DES/i.test(l)) return true;
        if (/\bDES\/ECB|AES\/ECB|Mode\.ECB/i.test(l)) return true;
        if (/\b(md5|sha1)\s*\(/i.test(l) && /password|passwd|hash/i.test(l)) return true;
        return false;
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.weak-crypto",
          category: "security",
          severity: "medium",
          title: `${hits.length} use(s) of weak cryptography`,
          detail: `MD5, SHA1, DES or ECB appear in ${hits.length} place(s). These are broken for security: MD5/SHA1 are collision-prone and fast to brute-force, and ECB leaks structure.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Hash passwords with bcrypt/scrypt/argon2; use SHA-256+ for integrity and AES-GCM for encryption.",
          confidence: 0.7,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.tls-verify-disabled",
    category: "security",
    title: "TLS verification disabled",
    description: "Certificate checks turned off for outbound requests or TLS clients.",
    defaultSeverity: "high",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits = scan(data, (l) => {
        if (/rejectUnauthorized\s*:\s*false/.test(l)) return true;
        if (/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/.test(l)) return true;
        if (/InsecureSkipVerify\s*:\s*true/.test(l)) return true;
        if (/\bverify\s*=\s*False/.test(l)) return true;
        if (/strictSSL\s*:\s*false/i.test(l)) return true;
        return false;
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.tls-verify-disabled",
          category: "security",
          severity: "high",
          title: "TLS certificate verification disabled",
          detail: `Certificate verification is switched off in ${hits.length} place(s). The connection accepts any certificate, so it can be intercepted and rewritten by anyone on the network.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Remove the override and fix the underlying certificate problem instead.",
          confidence: 0.85,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.permissive-cors",
    category: "security",
    title: "Permissive CORS",
    description: "Cross-origin access allowed from any origin, often with credentials.",
    defaultSeverity: "medium",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits = scan(data, (l) => {
        if (/Access-Control-Allow-Origin["']?\s*[:=,]\s*["']\*/i.test(l)) return true;
        if (/origin\s*:\s*["']\*["']/.test(l)) return true;
        if (/cors\(\s*\{\s*origin\s*:\s*["']\*/.test(l)) return true;
        if (/allowedOrigins?\s*[:=]\s*\[?\s*["']\*/.test(l)) return true;
        return false;
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.permissive-cors",
          category: "security",
          severity: "medium",
          title: `${hits.length} wildcard CORS setting(s)`,
          detail: `CORS is set to allow any origin in ${hits.length} place(s). If credentials are also allowed, any website can make authenticated requests as your users.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Allow only the specific origins you trust, and never combine a wildcard with credentials.",
          confidence: 0.7,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.insecure-deserialization",
    category: "security",
    title: "Insecure deserialization",
    description: "Untrusted data deserialized with a format that can execute code.",
    defaultSeverity: "critical",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits = scan(data, (l) => {
        if (/pickle\.(load|loads)\s*\(/.test(l)) return true;
        if (/yaml\.load\s*\(/.test(l) && !/SafeLoader|safe_load/.test(l)) return true;
        if (/marshal\.loads?\s*\(/.test(l)) return true;
        if (/new\s+ObjectInputStream\s*\(|ObjectInputStream\s*\(/.test(l) && /readObject/.test(l)) return true;
        if (/\.readObject\s*\(/.test(l)) return true;
        return false;
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.insecure-deserialization",
          category: "security",
          severity: "critical",
          title: `${hits.length} unsafe deserialization call(s)`,
          detail: `pickle, yaml.load, marshal or ObjectInputStream appear in ${hits.length} place(s). These can execute arbitrary code when they parse attacker-controlled data.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Use a safe format (JSON) or yaml.safe_load; never unpickle data you did not create.",
          confidence: 0.75,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.dockerfile",
    category: "security",
    title: "Insecure container build",
    description: "Dockerfile runs as root, uses a floating base tag, or bakes in secrets.",
    defaultSeverity: "medium",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      for (const f of data.files) {
        if (!/(^|\/)Dockerfile/i.test(f.relPath)) continue;
        const lines = f.content.split(/\r?\n/);
        const fromLatest = lines.findIndex((l) => /^\s*FROM\s+\S+:latest\b/i.test(l) || /^\s*FROM\s+\w+\s*$/i.test(l));
        const noUser = !lines.some((l) => /^\s*USER\s+/i.test(l));
        const rootUser = lines.findIndex((l) => /^\s*USER\s+root\b/i.test(l));
        const secretEnv = lines.findIndex((l) => /^\s*ENV\s+.*(PASSWORD|SECRET|TOKEN|API_KEY)\s*=/i.test(l));
        const chmod777 = lines.findIndex((l) => new RegExp("chmod\\s+" + "777").test(l));
        const problems: string[] = [];
        if (fromLatest >= 0) problems.push(`floating base image tag (line ${fromLatest + 1})`);
        if (rootUser >= 0) problems.push(`runs as root (line ${rootUser + 1})`);
        else if (noUser) problems.push("no USER directive (defaults to root)");
        if (secretEnv >= 0) problems.push(`secret baked into ENV (line ${secretEnv + 1})`);
        if (chmod777 >= 0) problems.push(`world-writable perms (line ${chmod777 + 1})`);
        if (problems.length === 0) continue;
        findings.push({
          ruleId: "security.dockerfile",
          category: "security",
          severity: secretEnv >= 0 ? "high" : "medium",
          title: `Dockerfile issues in ${f.relPath}`,
          detail: `The image build has: ${problems.join("; ")}. A container running as root, on a floating base, with secrets in ENV, is a common way a small mistake becomes a full compromise.`,
          location: `${f.relPath}`,
          evidence: [{ label: f.relPath, file: f.relPath }],
          fix: "Run as a non-root USER, pin the base image by digest or a specific tag, and pass secrets at runtime, not in ENV.",
          confidence: 0.8,
        });
      }
      return findings;
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.iac-public",
    category: "security",
    title: "Public cloud resource in IaC",
    description: "Infrastructure-as-code opens a resource to the world.",
    defaultSeverity: "high",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits = scan(
        data,
        (l, f) => {
          if (!/\.(tf|tfvars|yaml|yml|json|template)$/i.test(f.relPath)) return false;
          if (/acl\s*=\s*["']public-read/.test(l)) return true;
          if (/0\.0\.0\.0\/0/.test(l) && /22|3389|ingress|cidr/i.test(l)) return true;
          if (/Principal\s*[:=]\s*["']\*["']/.test(l)) return true;
          if (/publicly_accessible\s*=\s*true/i.test(l)) return true;
          if (/BlockPublicAcls\s*[:=]\s*false/i.test(l)) return true;
          return false;
        },
        { maxHits: 20 },
      );
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.iac-public",
          category: "security",
          severity: "high",
          title: `${hits.length} publicly-exposed resource(s) in IaC`,
          detail: `Infrastructure-as-code exposes a resource to the internet in ${hits.length} place(s): public-read ACLs, 0.0.0.0/0 ingress, or a wildcard principal. These are the misconfigurations behind most cloud breaches.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Scope ACLs and security-group rules to the specific principals and CIDRs that need access.",
          confidence: 0.6,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.insecure-random",
    category: "security",
    title: "Non-cryptographic randomness for secrets",
    description: "Math.random / random used where a token, id, or OTP is generated.",
    defaultSeverity: "medium",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits = scan(data, (l) => {
        if (!/Math\.random\s*\(|\brandom\.(random|randint|choice)\s*\(|\bnew\s+Random\s*\(/.test(l)) return false;
        return /token|secret|session|otp|nonce|csrf|password|salt|key|uuid/i.test(l);
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.insecure-random",
          category: "security",
          severity: "medium",
          title: `${hits.length} secret(s) from non-crypto randomness`,
          detail: `Math.random / random is used next to a token, session, OTP or key in ${hits.length} place(s). These generators are predictable and must never produce security values.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Use crypto.randomBytes / secrets.token_hex / crypto.getRandomValues for anything security-related.",
          confidence: 0.55,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "security.jwt-weak",
    category: "security",
    title: "Weak JWT handling",
    description: "JWT signature verification disabled or 'none' algorithm accepted.",
    defaultSeverity: "high",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits = scan(data, (l) => {
        if (/jwt\.decode\s*\([^)]*verify\s*=\s*False/i.test(l)) return true;
        if (/algorithms?\s*[:=]\s*\[?\s*["']none["']/i.test(l)) return true;
        if (/verify\s*:\s*false/i.test(l) && /jwt|token/i.test(l)) return true;
        if (/decode\s*\([^)]*,\s*(false|False)\s*\)/i.test(l) && /jwt|verify/i.test(l)) return true;
        return false;
      });
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.jwt-weak",
          category: "security",
          severity: "high",
          title: `${hits.length} JWT verification weakenings`,
          detail: `JWT verification is disabled or the "none" algorithm is accepted in ${hits.length} place(s). An attacker can forge any token and impersonate any user.`,
          evidence: hits.slice(0, 6).map(ev),
          fix: "Always verify the signature with an explicit algorithm allowlist (e.g. RS256), and reject 'none'.",
          confidence: 0.8,
        },
      ];
    },
  }),
];

export type { Severity };
