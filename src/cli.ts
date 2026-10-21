import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Registry } from "./core/registry.js";
import type {
  AuditOptions,
  AuditTarget,
  Category,
  Check,
  Finding,
  TargetKind,
} from "./core/types.js";
import { CATEGORIES } from "./core/types.js";
import { runChecks } from "./core/runner.js";
import { scoreFindings } from "./core/scoring.js";
import type { AuditReport } from "./core/report.js";
import { webChecks, collectWebSnapshot } from "./web/index.js";
import type { WebSnapshot } from "./web/index.js";
import { deepSecurityProbe } from "./web/deep-security.js";
import { loginAndSaveState } from "./web/login.js";
import { runAnalyzers, detectProject } from "./tools/index.js";
import { codeChecks, collectCodeSnapshot } from "./code/index.js";
import type { CodeSnapshot } from "./code/index.js";
import { desktopChecks, collectDesktopSnapshot } from "./desktop/index.js";
import type { DesktopSnapshot } from "./desktop/index.js";
import { nativeChecks, collectNativeSnapshot, runNativeSmoke, smokeFindings } from "./native/index.js";
import type { NativeSnapshot, SmokeResult } from "./native/index.js";
import { detectTarget } from "./core/detect.js";
import { renderTerminal } from "./reporters/terminal.js";
import { renderJson } from "./reporters/json.js";
import { renderHtml } from "./reporters/html.js";
import { renderPdf } from "./reporters/pdf.js";
import { runOllamaReview, listOllamaModels } from "./llm/ollama.js";
import {
  loadFileConfig,
  resolveFileConfig,
  validateFileConfig,
  type FileConfig,
} from "./core/file-config.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean | string[]> = {};
  const positionals: string[] = [];
  let command = "";
  let i = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    command = argv[0];
    i = 1;
  }
  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        addFlag(flags, key, arg.slice(eq + 1));
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          addFlag(flags, key, next);
          i += 1;
        } else {
          addFlag(flags, key, true);
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        addFlag(flags, key, next);
        i += 1;
      } else {
        addFlag(flags, key, true);
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}

function addFlag(flags: Record<string, string | boolean | string[]>, key: string, value: string | boolean): void {
  const existing = flags[key];
  if (existing === undefined) {
    flags[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(String(value));
  } else {
    flags[key] = [String(existing), String(value)];
  }
}

function flagString(flags: Record<string, string | boolean | string[]>, key: string): string | undefined {
  const v = flags[key];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v[v.length - 1];
  if (v === true) return "true";
  if (v === false) return undefined;
  return v;
}

function flagBool(flags: Record<string, string | boolean | string[]>, key: string): boolean {
  const v = flags[key];
  return v === true || v === "true" || v === "1";
}

function flagList(flags: Record<string, string | boolean | string[]>, key: string): string[] {
  const v = flags[key];
  if (v === undefined) return [];
  const raw = Array.isArray(v) ? v : [String(v)];
  return raw.flatMap((r) => r.split(",")).map((s) => s.trim()).filter(Boolean);
}

function buildRegistry(): Registry {
  const registry = new Registry();
  for (const check of webChecks) registry.register(check as Check);
  for (const check of codeChecks) registry.register(check as Check);
  for (const check of desktopChecks) registry.register(check as Check);
  for (const check of nativeChecks) registry.register(check as Check);
  return registry;
}

function selectCategories(
  registry: Registry,
  target: AuditTarget,
  requested: string[],
): Category[] {
  const available = registry.categoriesFor(target.kind);
  if (requested.length === 0) return available;
  const valid = requested.filter((c): c is Category => CATEGORIES.includes(c as Category));
  return available.filter((c) => valid.includes(c));
}

const HELP = `
slopaudit - deterministic auditor for AI-generated slop

USAGE
  slopaudit audit <url|path> [options]
  slopaudit login <login-url> [options]
  slopaudit checks [--target web|code|desktop|native]
  slopaudit models
  slopaudit init

OPTIONS
  --profile <name>      default | strict | marketing-site | a11y-first | lenient
  --type <web|code|desktop|native>  force target type (desktop: .NET/XAML/Avalonia,
                                 native: C/C++/Qt/DX/Vulkan/CMake)
  --categories <list>   comma-separated categories to run
  --disable <list>      comma-separated rule ids to skip
  --format <list>       terminal,json,html,pdf
  --out <dir>           write report.{json,html} into dir
  --screenshots         save viewport screenshots for web targets
  --full-page           full-page screenshots
  --viewports <list>    comma-separated widths (default 1440,768,375)
  --storage-state <f>   Playwright storage state JSON for authenticated pages
  --deep                active security probe: exposed files, user enumeration,
                        and secrets inside JS bundles. Only run on targets you
                        are authorized to test.
  --scan                code/native targets: run external analyzers when installed
                        (semgrep, osv-scanner, trivy, gitleaks, checkov, bandit,
                        pip-audit, npm audit, cppcheck, clang-tidy). Missing
                        tools are skipped.
  --smoke <exe>         native targets: launch the built app, resize and move
                        it, and report a crash, hang or missing window.
  --smoke-timeout <ms>  wait for the first window (default 20000).
  --disable-analyzer <id>  skip an analyzer by id (e.g. sca.npm-audit)
  --llm                 run the local Ollama review (separate grade)
  --model <name>        Ollama model to use (required with --llm; list with 'models')
  --llm-only            run only the LLM review (no deterministic grade)
  --config <path>       explicit config file
  --fail-under <n>      exit non-zero if deterministic score < n
  --verbose             show full detail and fixes in the terminal report
  --no-color            disable ANSI color
  -h, --help            show this help
`;

const LOGIN_HELP = `
slopaudit login - authenticate once, save the session for later audits

USAGE
  slopaudit login <login-url> --email <e> --password <pw> --save <file>

OPTIONS
  --email <e>            account email
  --password <pw>        account password
  --save <file>          where to write storage state (default .slopaudit-auth.json)
  --email-selector <s>   CSS selector for the email field (default #email)
  --password-selector <s>  CSS selector for the password field (default #password)
  --submit-selector <s>  CSS selector for the submit control
  --success-url <regex>  URL pattern that means login worked
  --success-selector <s>  element that appears only after login
  --headed               run with a visible browser (for debugging)

Then audit authenticated pages with:
  slopaudit audit <url> --storage-state <file>
`;

async function cmdAudit(parsed: ParsedArgs): Promise<number> {
  const ref = parsed.positionals[0];
  if (!ref) {
    process.stderr.write("error: audit requires a URL or path\n");
    return 2;
  }

  const { config: fileConfig, path: configPath } = await loadFileConfig(
    process.cwd(),
    flagString(parsed.flags, "config"),
  );
  const issues = validateFileConfig(fileConfig);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`config error: ${e.message}\n`);
    return 2;
  }

  const config = resolveFileConfig(fileConfig, flagString(parsed.flags, "profile"));
  const target = detectTarget(ref, flagString(parsed.flags, "type"));
  const registry = buildRegistry();
  const categories = selectCategories(registry, target, flagList(parsed.flags, "categories"));
  if (categories.length === 0) {
    process.stderr.write("error: no categories selected for this target\n");
    return 2;
  }

  const llmFlag = flagBool(parsed.flags, "llm");
  const llmOnly = flagBool(parsed.flags, "llm-only");
  const wantsLlm = llmFlag || llmOnly || fileConfig.llm?.enabled === true;

  const options: AuditOptions = {
    profile: config.profile,
    categories,
    disabledRules: flagList(parsed.flags, "disable"),
    config,
  };

  const warnings: string[] = [];
  const metadata: Record<string, unknown> = {};
  let findings: Finding[] = [];
  let checksSummary: AuditReport["checks"] = [];
  let durationMs = 0;
  let deterministicFindings: Finding[] = [];

  if (!llmOnly) {
    const runStart = Date.now();
    if (target.kind === "web") {
      const screenshots = flagBool(parsed.flags, "screenshots") || flagBool(parsed.flags, "full-page");
      const dir = screenshots
        ? path.join(flagString(parsed.flags, "out") ?? process.cwd(), "screenshots")
        : null;
      if (dir) {
        await fs.mkdir(dir, { recursive: true });
        metadata.screenshotsDir = dir;
      }
      const viewports = flagList(parsed.flags, "viewports")
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
      const storageStatePath = flagString(parsed.flags, "storage-state") ?? fileConfig.web?.storageState;
      if (storageStatePath) {
        try {
          await fs.access(path.resolve(storageStatePath));
          metadata.storageState = storageStatePath;
        } catch {
          process.stderr.write(`error: storage state file not found: ${storageStatePath}\n`);
          return 2;
        }
      }
      process.stderr.write(`collecting web snapshot of ${target.ref} ...\n`);
      const snapshot: WebSnapshot = await collectWebSnapshot({
        url: target.ref,
        viewports: viewports.length ? viewports : fileConfig.web?.viewports,
        timeoutMs: Number(flagString(parsed.flags, "timeout") ?? fileConfig.web?.timeoutMs ?? 30000),
        screenshotsDir: dir,
        fullPage: flagBool(parsed.flags, "full-page") || fileConfig.web?.fullPage,
        storageState: storageStatePath ? path.resolve(storageStatePath) : undefined,
      });
      metadata.finalUrl = snapshot.finalUrl;
      metadata.statusCode = snapshot.statusCode;
      metadata.viewportMeta = snapshot.viewportMeta;
      if (storageStatePath && /\/login/i.test(snapshot.finalUrl)) {
        warnings.push(
          `the page redirected to ${snapshot.finalUrl}; the stored session may be expired or insufficient for this route`,
        );
      }
      const result = await runChecks(target, snapshot, registry.forTarget("web"), options);
      findings = result.findings;
      durationMs = result.durationMs;
      checksSummary = summarize(result.results, registry);
      metadata.captures = snapshot.captures.map((c) => ({
        width: c.width,
        height: c.height,
        scrollWidth: c.scrollWidth,
        overflowAmount: c.overflowAmount,
        clipped: c.clipped ?? false,
        screenshot: c.screenshot ?? null,
      }));
      if (dir) {
        metadata.reportDir = path.basename(dir) === "screenshots" ? path.dirname(dir) : dir;
      }
      for (const e of result.errors) warnings.push(`check ${e.checkId} failed: ${e.error}`);

      if (flagBool(parsed.flags, "deep")) {
        process.stderr.write(
          "deep security probe: sending active requests (exposed files, user enumeration, JS bundle secrets)\n",
        );
        const base = new URL(snapshot.finalUrl);
        const deepFindings = await deepSecurityProbe({
          baseUrl: `${base.protocol}//${base.host}`,
          timeoutMs: Number(flagString(parsed.flags, "timeout") ?? 8000),
        });
        findings.push(...deepFindings);
        metadata.deepProbe = true;
      }
    } else if (target.kind === "desktop") {
      process.stderr.write(`collecting desktop snapshot of ${target.ref} ...\n`);
      const snapshot: DesktopSnapshot = await collectDesktopSnapshot({
        root: target.ref,
        maxFiles: Number(flagString(parsed.flags, "max-files") ?? fileConfig.code?.maxFiles ?? 6000),
      });
      metadata.totalFiles = snapshot.totalFiles;
      metadata.totalLines = snapshot.totalLines;
      metadata.frameworks = snapshot.frameworks;
      const result = await runChecks(target, snapshot, registry.forTarget("desktop"), options);
      findings = result.findings;
      durationMs = result.durationMs;
      checksSummary = summarize(result.results, registry);
      for (const e of result.errors) warnings.push(`check ${e.checkId} failed: ${e.error}`);
    } else if (target.kind === "native") {
      process.stderr.write(`collecting native snapshot of ${target.ref} ...\n`);
      const snapshot: NativeSnapshot = await collectNativeSnapshot({
        root: target.ref,
        maxFiles: Number(flagString(parsed.flags, "max-files") ?? fileConfig.code?.maxFiles ?? 8000),
      });
      metadata.totalFiles = snapshot.totalFiles;
      metadata.totalLines = snapshot.totalLines;
      metadata.frameworks = snapshot.frameworks;
      metadata.testFrameworks = snapshot.testFrameworks;
      const result = await runChecks(target, snapshot, registry.forTarget("native"), options);
      findings = result.findings;
      durationMs = result.durationMs;
      checksSummary = summarize(result.results, registry);
      for (const e of result.errors) warnings.push(`check ${e.checkId} failed: ${e.error}`);

      if (flagBool(parsed.flags, "scan")) {
        const info = await detectProject(snapshot.root);
        process.stderr.write("running external analyzers (cppcheck, clang-tidy, semgrep, …)\n");
        const { findings: analyzerFindings, runs } = await runAnalyzers(info, {
          timeoutMs: Number(flagString(parsed.flags, "timeout") ?? 180000),
          disabled: flagList(parsed.flags, "disable-analyzer"),
        });
        findings.push(...analyzerFindings);
        metadata.analyzers = runs;
        const skipped = runs.filter((r) => !r.ran && r.note);
        if (skipped.length > 0) {
          warnings.push(
            `analyzers not run: ${skipped.map((r) => `${r.name} (${r.note})`).join(", ")}`,
          );
        }
      }

      const smokeFlag = flagString(parsed.flags, "smoke");
      if (smokeFlag) {
        if (smokeFlag === "true") {
          process.stderr.write("error: --smoke requires the path to the built executable\n");
          return 2;
        }
        const exe = path.resolve(smokeFlag);
        process.stderr.write(`runtime smoke: launching ${exe} ...\n`);
        const smoke: SmokeResult = await runNativeSmoke({
          exe,
          cwd: path.dirname(exe),
          timeoutMs: Number(flagString(parsed.flags, "smoke-timeout") ?? 20000),
        });
        metadata.smoke = smoke;
        durationMs += smoke.durationMs;
        if (!smoke.ran) {
          warnings.push(`runtime smoke not run: ${smoke.error ?? smoke.note ?? "unknown"}`);
        } else if (smoke.error) {
          warnings.push(`runtime smoke failed: ${smoke.error}`);
        }
        const smokeResult = smokeFindings(smoke, path.basename(exe));
        findings.push(...smokeResult);
        if (smoke.ran && !smoke.error && smokeResult.length === 0) {
          metadata.smokeClean = true;
        }
      }
    } else {
      process.stderr.write(`collecting code snapshot of ${target.ref} ...\n`);
      const snapshot: CodeSnapshot = await collectCodeSnapshot({
        root: target.ref,
        maxFiles: Number(flagString(parsed.flags, "max-files") ?? fileConfig.code?.maxFiles ?? 8000),
        include: flagList(parsed.flags, "include").length
          ? flagList(parsed.flags, "include")
          : fileConfig.code?.include,
      });
      metadata.totalFiles = snapshot.totalFiles;
      metadata.totalLines = snapshot.totalLines;
      metadata.languages = snapshot.languages;
      const result = await runChecks(target, snapshot, registry.forTarget("code"), options);
      findings = result.findings;
      durationMs = result.durationMs;
      checksSummary = summarize(result.results, registry);
      for (const e of result.errors) warnings.push(`check ${e.checkId} failed: ${e.error}`);

      if (flagBool(parsed.flags, "scan")) {
        const info = await detectProject(snapshot.root);
        process.stderr.write("running external analyzers (semgrep, osv-scanner, trivy, gitleaks, …)\n");
        const { findings: analyzerFindings, runs } = await runAnalyzers(info, {
          timeoutMs: Number(flagString(parsed.flags, "timeout") ?? 180000),
          disabled: flagList(parsed.flags, "disable-analyzer"),
        });
        findings.push(...analyzerFindings);
        metadata.analyzers = runs;
        const skipped = runs.filter((r) => !r.ran && r.note);
        if (skipped.length > 0) {
          warnings.push(
            `analyzers not run: ${skipped.map((r) => `${r.name} (${r.note})`).join(", ")}`,
          );
        }
      }
    }
    deterministicFindings = findings;
  }

  const deterministic = scoreFindings(deterministicFindings, config, categories);

  const report: AuditReport = {
    tool: "slopaudit",
    version: pkg.version,
    target,
    profile: config.profile,
    generatedAt: new Date().toISOString(),
    durationMs,
    deterministic,
    llm: null,
    checks: checksSummary,
    findings,
    warnings,
    metadata,
  };

  if (configPath) metadata.configPath = configPath;

  if (wantsLlm) {
    const model = flagString(parsed.flags, "model") ?? fileConfig.llm?.model;
    if (!model) {
      report.llm = {
        enabled: false,
        model: null,
        score: null,
        grade: null,
        summary: null,
        findings: [],
        error: "no model specified (pass --model or set llm.model in config)",
      };
    } else {
      process.stderr.write(`running LLM review with ${model} ...\n`);
      report.llm = await runOllamaReview(report, {
        model,
        baseUrl: flagString(parsed.flags, "llm-url") ?? fileConfig.llm?.baseUrl,
      });
      if (report.llm.error) warnings.push(`llm review: ${report.llm.error}`);
    }
  }

  const formats = flagList(parsed.flags, "format");
  const wanted = formats.length ? formats : ["terminal"];
  const outDir = flagString(parsed.flags, "out");

  for (const format of wanted) {
    if (format === "json") {
      const json = renderJson(report);
      if (outDir) {
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(path.join(outDir, "report.json"), json);
        process.stderr.write(`wrote ${path.join(outDir, "report.json")}\n`);
      } else {
        process.stdout.write(json + "\n");
      }
    } else if (format === "html") {
      const html = renderHtml(report);
      if (outDir) {
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(path.join(outDir, "report.html"), html);
        process.stderr.write(`wrote ${path.join(outDir, "report.html")}\n`);
      } else {
        process.stdout.write(html + "\n");
      }
    } else if (format === "pdf") {
      if (!outDir) {
        process.stderr.write("error: --format pdf requires --out <dir>\n");
        return 2;
      }
      await fs.mkdir(outDir, { recursive: true });
      const htmlPath = path.join(outDir, "report.html");
      if (!formats.includes("html")) {
        await fs.writeFile(htmlPath, renderHtml(report));
      }
      const pdfPath = path.join(outDir, "report.pdf");
      await renderPdf(htmlPath, pdfPath);
      process.stderr.write(`wrote ${pdfPath}\n`);
    } else {
      const useColor = !flagBool(parsed.flags, "no-color") && process.stdout.isTTY !== false;
      process.stdout.write(
        renderTerminal(report, {
          useColor,
          verbose: flagBool(parsed.flags, "verbose"),
        }) + "\n",
      );
    }
  }

  const failUnderRaw = flagString(parsed.flags, "fail-under") ?? (fileConfig.failUnder !== undefined ? String(fileConfig.failUnder) : undefined);
  if (failUnderRaw !== undefined) {
    const failUnder = Number(failUnderRaw);
    if (Number.isFinite(failUnder) && !llmOnly && deterministic.score < failUnder) {
      process.stderr.write(`score ${deterministic.score} is below --fail-under ${failUnder}\n`);
      return 1;
    }
  }
  return 0;
}

function summarize(
  results: Array<{ checkId: string; ok: boolean; findings: Finding[]; durationMs?: number; error?: string }>,
  registry: Registry,
): AuditReport["checks"] {
  return results.map((r) => ({
    checkId: r.checkId,
    category: registry.get(r.checkId)?.category ?? "code",
    ok: r.ok,
    findings: r.findings.length,
    durationMs: r.durationMs,
    error: r.error,
  }));
}

function cmdChecks(parsed: ParsedArgs): number {
  const registry = buildRegistry();
  const targetFilter = flagString(parsed.flags, "target");
  const metas = registry
    .meta()
    .filter((m) => !targetFilter || m.appliesTo.includes(targetFilter as TargetKind))
    .sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  let currentCategory = "";
  for (const m of metas) {
    if (m.category !== currentCategory) {
      currentCategory = m.category;
      process.stdout.write(`\n${currentCategory.toUpperCase()}\n`);
    }
    process.stdout.write(`  ${m.id.padEnd(34)} ${m.defaultSeverity.padEnd(9)} ${m.title}\n`);
  }
  process.stdout.write(`\n${metas.length} checks\n`);
  return 0;
}

async function cmdModels(): Promise<number> {
  try {
    const models = await listOllamaModels();
    process.stdout.write(`Ollama models (${models.length}):\n`);
    for (const m of models) {
      process.stdout.write(`  ${m.name.padEnd(34)} ${(m.size / 1e9).toFixed(1)} GB\n`);
    }
    process.stdout.write('\nUse one with: --llm --model <name>\n');
    return 0;
  } catch (err) {
    process.stderr.write(
      `could not reach Ollama: ${err instanceof Error ? err.message : String(err)}\n` +
        "is `ollama serve` running?\n",
    );
    return 1;
  }
}

async function cmdLogin(parsed: ParsedArgs): Promise<number> {
  const loginUrl = parsed.positionals[0];
  if (!loginUrl) {
    process.stderr.write("error: login requires a login URL\n" + LOGIN_HELP);
    return 2;
  }
  const outFile = path.resolve(
    flagString(parsed.flags, "save") ?? ".slopaudit-auth.json",
  );
  process.stderr.write(`logging in at ${loginUrl} ...\n`);
  const result = await loginAndSaveState({
    loginUrl,
    email: flagString(parsed.flags, "email"),
    password: flagString(parsed.flags, "password"),
    emailSelector: flagString(parsed.flags, "email-selector"),
    passwordSelector: flagString(parsed.flags, "password-selector"),
    submitSelector: flagString(parsed.flags, "submit-selector"),
    successUrl: flagString(parsed.flags, "success-url"),
    successSelector: flagString(parsed.flags, "success-selector"),
    outFile,
    headless: !flagBool(parsed.flags, "headed"),
  });
  process.stdout.write(`${result.success ? "ok" : "warn"}: ${result.detail}\n`);
  process.stdout.write(`saved session to ${result.storageStatePath}\n`);
  if (!result.success) {
    process.stderr.write(
      "warning: login was not confirmed. If the page is a SPA, pass --success-selector or --success-url.\n",
    );
  }
  return 0;
}

async function cmdInit(): Promise<number> {
  const target = path.join(process.cwd(), "slopaudit.config.json");
  try {
    await fs.access(target);
    process.stderr.write(`${target} already exists\n`);
    return 1;
  } catch {
    // proceed
  }
  const template: FileConfig = {
    profile: "default",
    llm: { enabled: false, model: "qwen3-coder:30b" },
    rules: {
      "color.purple-blue-gradient": { severity: "high" },
    },
    web: { viewports: [1440, 768, 375] },
    code: { maxFiles: 8000 },
    failUnder: 70,
  };
  await fs.writeFile(target, JSON.stringify(template, null, 2) + "\n");
  process.stdout.write(`wrote ${target}\n`);
  return 0;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (flagBool(parsed.flags, "help") || parsed.command === "help" || !parsed.command) {
    process.stdout.write(HELP);
    process.exit(parsed.command === "" ? 0 : 0);
  }

  let code = 0;
  switch (parsed.command) {
    case "audit":
      code = await cmdAudit(parsed);
      break;
    case "login":
      code = await cmdLogin(parsed);
      break;
    case "checks":
      code = cmdChecks(parsed);
      break;
    case "models":
      code = await cmdModels();
      break;
    case "init":
      code = await cmdInit();
      break;
    default:
      process.stderr.write(`unknown command: ${parsed.command}\n${HELP}`);
      code = 2;
  }
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(2);
});
