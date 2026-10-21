#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "src", "cli.ts");
const tsxBin = path.join(here, "..", "node_modules", "tsx", "dist", "cli.mjs");

const args = [existsSync(tsxBin) ? tsxBin : "tsx", entry, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
