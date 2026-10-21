import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

function header(data: WebSnapshot, name: string): string | null {
  const v = data.responseHeaders[name.toLowerCase()];
  return typeof v === "string" ? v : null;
}

export const securityChecks = [
  defineCheck<WebSnapshot>({
    id: "security.hsts",
    category: "security",
    title: "Missing HSTS",
    description:
      "No Strict-Transport-Security header, so downgrade to http is not prevented.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (!data.finalUrl.startsWith("https://")) return [];
      if (header(data, "strict-transport-security")) return [];
      return [
        {
          ruleId: "security.hsts",
          category: "security",
          severity: "medium",
          title: "No Strict-Transport-Security header",
          detail:
            "Without HSTS, the first request (and any link) can be downgraded to plain http and intercepted before the redirect to https.",
          fix: 'Send "Strict-Transport-Security: max-age=63072000; includeSubDomains" on all https responses.',
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.csp",
    category: "security",
    title: "Missing Content-Security-Policy",
    description:
      "No CSP header, so injected scripts have no browser-enforced boundary.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (header(data, "content-security-policy")) return [];
      const hasInline = data.inlineScriptBytes > 0;
      return [
        {
          ruleId: "security.csp",
          category: "security",
          severity: hasInline ? "high" : "medium",
          title: "No Content-Security-Policy header",
          detail: hasInline
            ? `The page runs ${data.inlineScriptBytes} bytes of inline script and sets no CSP. Any HTML-injection point then executes script with no browser-level mitigation.`
            : "No CSP is set. CSP is the main defense-in-depth control against XSS; its absence is a common finding in generated apps.",
          fix: "Add a restrictive CSP (default-src 'self'; script-src with nonces or hashes; object-src 'none') and test it in report-only first.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.clickjacking",
    category: "security",
    title: "Clickjacking protection",
    description:
      "Missing X-Frame-Options and CSP frame-ancestors, allowing the page to be framed.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const csp = header(data, "content-security-policy") ?? "";
      if (header(data, "x-frame-options") || /frame-ancestors/i.test(csp)) return [];
      return [
        {
          ruleId: "security.clickjacking",
          category: "security",
          severity: "low",
          title: "Page can be framed by any origin",
          detail:
            "Neither X-Frame-Options nor CSP frame-ancestors is set, so the page can be embedded in an attacker's iframe for clickjacking.",
          fix: "Send X-Frame-Options: DENY (or SAMEORIGIN), or set CSP frame-ancestors.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.nosniff",
    category: "security",
    title: "Missing X-Content-Type-Options",
    description:
      "No nosniff header, so browsers may MIME-sniff responses.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const v = header(data, "x-content-type-options");
      if (v && v.toLowerCase().includes("nosniff")) return [];
      return [
        {
          ruleId: "security.nosniff",
          category: "security",
          severity: "low",
          title: "X-Content-Type-Options is not nosniff",
          detail:
            "Without nosniff, a browser may treat a non-script response as script. It is a cheap, one-line hardening header.",
          fix: "Send X-Content-Type-Options: nosniff on all responses.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.mixed-content",
    category: "security",
    title: "Mixed content",
    description:
      "An https page loads subresources over plain http.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (!data.finalUrl.startsWith("https://")) return [];
      const insecure = [...data.scriptSources, ...data.stylesheets].filter(
        (s) => s.startsWith("http://"),
      );
      if (insecure.length === 0) return [];
      return [
        {
          ruleId: "security.mixed-content",
          category: "security",
          severity: "high",
          title: `${insecure.length} subresource(s) loaded over http`,
          detail: `Loading active content over http on an https page lets a network attacker replace it: ${insecure
            .slice(0, 3)
            .join(", ")}.`,
          evidence: insecure.slice(0, 5).map((s) => ({ label: "url", value: s })),
          fix: "Load every subresource over https (or protocol-relative).",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.cookies",
    category: "security",
    title: "Insecure cookie flags",
    description:
      "Cookies set without Secure and HttpOnly, or without SameSite.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (!data.finalUrl.startsWith("https://")) return [];
      const raw = header(data, "set-cookie");
      if (!raw) return [];
      const cookies = raw.split(/,(?=\s*[^;=]+=)/);
      const findings: Finding[] = [];
      for (const cookie of cookies) {
        const name = cookie.split("=")[0]?.trim() ?? "cookie";
        const missing: string[] = [];
        if (!/;\s*secure\b/i.test(cookie)) missing.push("Secure");
        if (!/;\s*httponly\b/i.test(cookie)) missing.push("HttpOnly");
        if (!/;\s*samesite=/i.test(cookie)) missing.push("SameSite");
        if (missing.length === 0) continue;
        findings.push({
          ruleId: "security.cookies",
          category: "security",
          severity: missing.includes("Secure") ? "medium" : "low",
          title: `Cookie "${name}" is missing ${missing.join(", ")}`,
          detail: `The cookie is set without: ${missing.join(", ")}. A session cookie without Secure can leak over http; without HttpOnly it is readable by any injected script.`,
          evidence: [{ label: name, value: cookie.slice(0, 100) }],
          fix: "Set Secure and HttpOnly on session cookies and SameSite=Lax or Strict.",
        });
      }
      return findings.slice(0, 5);
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.version-disclosure",
    category: "security",
    title: "Software version disclosure",
    description:
      "Headers reveal server or framework versions, giving attackers a starting point.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      for (const name of ["server", "x-powered-by", "x-aspnet-version", "x-generator"]) {
        const v = header(data, name);
        if (!v) continue;
        if (/^[\w-]+$/i.test(v) && /\d/.test(v) === false) continue;
        findings.push({
          ruleId: "security.version-disclosure",
          category: "security",
          severity: "low",
          title: `${name} header discloses software details`,
          detail: `"${name}: ${v}" tells an attacker which stack and version to target. Version banners are free reconnaissance.`,
          evidence: [{ label: name, value: v }],
          fix: `Remove or genericize the ${name} header at the server/proxy.`,
        });
      }
      return findings;
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.secrets-in-bundle",
    category: "security",
    title: "Secrets shipped to the client",
    description:
      "High-signal secret patterns appear in the page source or script URLs (client-side values are public).",
    defaultSeverity: "critical",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const haystack = [
        data.title,
        data.inlineScriptBytes > 0 ? "inline scripts present" : "",
        ...data.scriptSources,
        ...data.stylesheets,
      ]
        .join("\n");
      const patterns: Array<{ re: RegExp; label: string }> = [
        { re: /sk_live_[0-9a-zA-Z]{16,}/, label: "Stripe live secret key" },
        { re: /AKIA[0-9A-Z]{16}/, label: "AWS access key id" },
        { re: /ghp_[0-9a-zA-Z]{36}/, label: "GitHub personal access token" },
        { re: /AIza[0-9A-Za-z_-]{35}/, label: "Google API key" },
        { re: /xox[baprs]-[0-9a-zA-Z-]{10,}/, label: "Slack token" },
      ];
      const hits = patterns.filter((p) => p.re.test(haystack));
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "security.secrets-in-bundle",
          category: "security",
          severity: "critical",
          title: "Secret-like token visible in client assets",
          detail: `Matched: ${hits.map((h) => h.label).join(", ")}. Anything shipped to the browser is public. If any of these are real, rotate immediately.`,
          evidence: hits.map((h) => ({ label: h.label })),
          fix: "Move the secret server-side, rotate the exposed value, and load it at runtime.",
          confidence: 0.6,
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.csp-weak",
    category: "security",
    title: "Weak Content-Security-Policy",
    description:
      "A CSP is present but allows unsafe-inline, unsafe-eval, or a wildcard source, so it barely mitigates XSS.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const csp = header(data, "content-security-policy");
      if (!csp) return [];
      const issues: string[] = [];
      if (/unsafe-inline/i.test(csp)) issues.push("'unsafe-inline'");
      if (/unsafe-eval/i.test(csp)) issues.push("'unsafe-eval'");
      if (/\s\*\s|;\s*\*|default-src[^;]*\*/.test(csp) || /(?:^|[;\s])\*/.test(csp))
        issues.push("wildcard source (*)");
      if (/script-src[^;]*(?:http:|https:\/\/\*)/i.test(csp))
        issues.push("broad script-src host");
      if (issues.length === 0) return [];
      return [
        {
          ruleId: "security.csp-weak",
          category: "security",
          severity: /unsafe-inline|unsafe-eval/.test(csp) ? "medium" : "low",
          title: `CSP weakened by ${issues.join(", ")}`,
          detail: `A CSP header is set, which is good, but it contains ${issues.join(", ")}. These let an injected inline script run, which is the exact thing CSP is meant to stop.`,
          evidence: [{ label: "content-security-policy", value: csp.slice(0, 160) }],
          fix: "Remove unsafe-inline/unsafe-eval (use nonces or hashes) and avoid wildcard sources.", // sec-ok: eval: this is a string naming a CSP directive, not an eval() call
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.sri",
    category: "security",
    title: "Subresources without integrity",
    description:
      "Cross-origin scripts or stylesheets loaded without a Subresource Integrity hash.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const noSri = (data.scriptTags ?? []).filter((s) => s.crossOrigin && !s.integrity);
      const noSriLinks = (data.linkedResources ?? []).filter(
        (l) => /stylesheet/.test(l.rel) && /^https?:\/\//.test(l.href) && !l.integrity,
      );
      const total = noSri.length + noSriLinks.length;
      if (total === 0) return [];
      return [
        {
          ruleId: "security.sri",
          category: "security",
          severity: "low",
          title: `${total} third-party resource(s) without SRI`,
          detail: `${noSri.length} external script(s) and ${noSriLinks.length} external stylesheet(s) load without an integrity hash. If the CDN or package is compromised, the browser will run whatever it serves. This is the supply-chain half of a client-side attack.`,
          evidence: [
            ...noSri.map((s) => ({ label: s.origin || s.src })),
            ...noSriLinks.map((l) => ({ label: l.href })),
          ]
            .slice(0, 6)
            .map((r) => ({ label: r.label.slice(0, 70) })),
          fix: "Add an integrity hash (and crossorigin) to each third-party script and stylesheet, or self-host it.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.policy-headers",
    category: "security",
    title: "Missing policy headers",
    description:
      "No Referrer-Policy or Permissions-Policy, so the browser's default behavior leaks referrer data and enables powerful APIs.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const missing: string[] = [];
      if (!header(data, "referrer-policy")) missing.push("Referrer-Policy");
      if (!header(data, "permissions-policy") && !header(data, "feature-policy"))
        missing.push("Permissions-Policy");
      if (missing.length === 0) return [];
      return [
        {
          ruleId: "security.policy-headers",
          category: "security",
          severity: "low",
          title: `Missing ${missing.join(" and ")}`,
          detail: `The response sets no ${missing.join(" or ")}. Referrer-Policy controls how much URL data leaks to third parties; Permissions-Policy gates camera, microphone, geolocation and other powerful features that are otherwise available to any embedded script.`,
          evidence: missing.map((m) => ({ label: m, value: "not set" })),
          fix: `Send Referrer-Policy: strict-origin-when-cross-origin and a Permissions-Policy that denies features you do not use.`,
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.insecure-form",
    category: "security",
    title: "Insecure form submission",
    description:
      "A form collects credentials or personal data and posts it over plain http or to a third party.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      for (const f of data.forms ?? []) {
        if (f.passwordOverHttp) {
          findings.push({
            ruleId: "security.insecure-form",
            category: "security",
            severity: "critical",
            title: "Password form submits over plain http",
            detail: `A form containing a password field posts to ${f.action}, which is not https. Credentials are sent in the clear and can be read by anyone on the network.`,
            evidence: [{ label: "action", value: f.action.slice(0, 100) }],
            fix: "Serve the page and the form endpoint over https only, and add HSTS.",
          });
        } else if (f.hasPassword && /^https?:\/\//.test(f.action) && !f.secure) {
          findings.push({
            ruleId: "security.insecure-form",
            category: "security",
            severity: "medium",
            title: "Password form posts to an unexpected host",
            detail: `A password field submits to ${f.action}. Confirm that is your own authentication endpoint and not a third party.`,
            evidence: [{ label: "action", value: f.action.slice(0, 100) }],
            fix: "Point password forms only at your own authentication endpoint over https.",
          });
        }
      }
      return findings;
    },
  }),

  defineCheck<WebSnapshot>({
    id: "security.third-party-scripts",
    category: "security",
    title: "Third-party script surface",
    description:
      "A large number of distinct external origins load executable script into the page.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const origins = [
        ...new Set((data.scriptTags ?? []).map((s) => s.origin).filter(Boolean)),
      ] as string[];
      if (origins.length < 5) return [];
      return [
        {
          ruleId: "security.third-party-scripts",
          category: "security",
          severity: origins.length >= 10 ? "medium" : "low",
          title: `${origins.length} third-party script origins`,
          detail: `Script from ${origins.length} external origins runs on the page: ${origins
            .slice(0, 6)
            .map((o) => o.replace(/^https?:\/\//, ""))
            .join(", ")}${origins.length > 6 ? ", …" : ""}. Each origin is another company whose compromise becomes your compromise, and every one can read the DOM, form fields and storage.`,
          evidence: origins.slice(0, 8).map((o) => ({ label: o })),
          fix: "Audit the list; remove what you do not need and prefer first-party or self-hosted where possible.",
        },
      ];
    },
  }),
];
