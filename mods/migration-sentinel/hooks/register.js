// mods/migration-sentinel/src/register.tsx
import { atom, update } from "claude-code";

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";
function normalizePath(input) {
  let path = input.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  return path;
}

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/log.ts
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// packages/core/src/migrations.ts
var RULES = [
  { id: "drop-object", severity: "destructive", pattern: /\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)\b/i },
  { id: "truncate", severity: "destructive", pattern: /\bTRUNCATE\b/i },
  { id: "rename", severity: "destructive", pattern: /\bRENAME\s+(COLUMN|TO)\b/i },
  { id: "update-without-where", severity: "destructive", pattern: /\bUPDATE\s+\w+\s+SET\b(?![^;]*\bWHERE\b)/i },
  { id: "not-null-without-default", severity: "review", pattern: /\bADD\s+COLUMN\s+(?![^;]*\bDEFAULT\b)[^;]*\bNOT\s+NULL\b/i },
  { id: "set-not-null", severity: "review", pattern: /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i },
  { id: "index-not-concurrent", severity: "review", pattern: /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)/i }
];
function classifyMigrationSql(text) {
  const findings = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (/reviewed:/i.test(line)) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ severity: rule.severity, rule: rule.id, line: index + 1, text: line.trim().slice(0, 200) });
      }
    }
  });
  return findings;
}
var MIGRATION_PATH = /(^|\/)(migrations?|db\/migrate|flyway|liquibase|alembic\/versions|prisma\/migrations)(\/|$)|\.sql$/i;

// mods/migration-sentinel/src/register.tsx
var IDLE = { verdict: "UNKNOWN", findings: [] };
var status = atom({ plugin: "migration-sentinel", key: "status" }, IDLE, { shape: "status-1" });
function verdictOf(findings) {
  if (findings.some((item) => item.severity === "destructive")) return "FAIL";
  if (findings.length > 0) return "UNKNOWN";
  return "PASS";
}
async function publish($, path, findings) {
  const lines = findings.map(
    (item) => `${path}:${item.line} ${item.severity} ${item.rule}: ${truncate(item.text, 160)}`
  );
  await update($, status, () => ({ verdict: verdictOf(findings), findings: lines.slice(0, 50) }));
  for (const finding of findings) {
    if (finding.severity === "destructive") {
      $.ui.toast(`migration-sentinel: ${finding.rule} in ${path}. Review before release.`);
    }
  }
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "migration",
      description: "Check a migration file: /migration check <path>"
    });
    return next(e);
  });
  on("command.run", { command: "migration" }, async ($, e) => {
    const [subcommand = "", ...rest] = e.args.trim().split(/\s+/);
    if (subcommand !== "check" || rest.length === 0) {
      return { text: "Usage: /migration check <path to a migration file>" };
    }
    const path = normalizePath(rest.join(" "));
    let sql;
    try {
      sql = await $.fs.read(path);
    } catch {
      return { text: `Cannot read ${path}. Check the path, relative to the repository root.` };
    }
    const findings = classifyMigrationSql(sql);
    await publish($, path, findings);
    if (findings.length === 0) return { text: `${path}: no destructive or locking patterns found.` };
    return { text: findings.map((item) => `line ${item.line}: ${item.severity} ${item.rule}`).join("\n") };
  });
  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    if (MIGRATION_PATH.test(e.file_path)) {
      await publish($, e.file_path, classifyMigrationSql(e.new_string));
    }
    return next(e);
  });
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    if (MIGRATION_PATH.test(e.file_path)) {
      await publish($, e.file_path, classifyMigrationSql(e.content));
    }
    return next(e);
  });
}
export {
  register
};
