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
var SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}/gi,
  /\b(api[_-]?key|access[_-]?token|secret|password|passwd)\b(\s*[:=]\s*)\S+/gi
];
function redact(text) {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_match, ...rest) => {
      const label = typeof rest[0] === "string" && rest[0].length < 40 ? rest[0] : "";
      const separator = typeof rest[1] === "string" ? rest[1] : "";
      return label.length > 0 ? `${label}${separator}[redacted]` : "[redacted]";
    });
  }
  return out;
}
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// packages/core/src/ci.ts
var RULES = [
  {
    category: "credentials",
    pattern: /(401 Unauthorized|403 Forbidden|Bad credentials|authentication failed|expired token|invalid_grant|No linked GitHub account)/i,
    action: "Stop fixing code. Refresh the credential or access grant, then rerun the job.",
    stopLoop: true
  },
  {
    category: "infrastructure",
    pattern: /(ECONNRESET|ETIMEDOUT|ENOTFOUND|503 Service|502 Bad Gateway|rate limit|quota exceeded|No space left on device|runner .* lost|The operation was canceled)/i,
    action: "Stop fixing code. Rerun the job or check the runner and quota.",
    stopLoop: true
  },
  {
    category: "flaky-test",
    pattern: /(flaky|retrying test|passed on retry|intermittent)/i,
    action: "Quarantine the test with an owner and an issue, then fix its nondeterminism.",
    stopLoop: false
  },
  {
    category: "compilation",
    pattern: /(error TS\d+|SyntaxError|cannot find symbol|COMPILATION ERROR|error\[E\d+\]|build failed)/i,
    action: "Reproduce locally with the build command and fix the first compiler error.",
    stopLoop: false
  },
  {
    category: "lint-format",
    pattern: /(eslint|prettier --check|ruff check|golangci-lint|clippy::|formatting differences)/i,
    action: "Run the formatter and linter locally; fix the reported files.",
    stopLoop: false
  },
  {
    category: "security-scan",
    pattern: /(vulnerab|CVE-\d{4}-\d+|npm audit|pip-audit|osv-scanner|secret detected)/i,
    action: "Triage the finding; update the dependency or document an accepted risk.",
    stopLoop: false
  },
  {
    category: "performance",
    pattern: /(benchmark regression|budget exceeded|performance budget|p95 .* exceeded)/i,
    action: "Compare against the baseline; profile the changed path before changing code.",
    stopLoop: false
  },
  {
    category: "integration-test",
    pattern: /(integration test|e2e|testcontainers|connection refused.*(5432|6379|9092))/i,
    action: "Check the service dependencies the test needs, then reproduce with the same services up.",
    stopLoop: false
  },
  {
    category: "unit-test",
    pattern: /(AssertionError|expect\(|FAIL\s|\d+ failed|Tests?:\s+\d+ failed)/i,
    action: "Reproduce the failing test locally and fix its behaviour, not the assertion.",
    stopLoop: false
  }
];
function triageLog(text) {
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match !== null) {
      return {
        category: rule.category,
        evidence: match[0].slice(0, 120),
        action: rule.action,
        stopLoop: rule.stopLoop
      };
    }
  }
  return {
    category: "unknown",
    evidence: "",
    action: "Read the first error in the log and reproduce it locally before changing code.",
    stopLoop: false
  };
}

// mods/ci-triage/src/register.tsx
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "ci",
      description: "Triage a CI log file: /ci triage <path to the downloaded log>"
    });
    return next(e);
  });
  on("command.run", { command: "ci" }, async ($, e) => {
    const [subcommand = "", ...rest] = e.args.trim().split(/\s+/);
    if (subcommand !== "triage" || rest.length === 0) {
      return {
        text: "Usage: /ci triage <path to the log file>. Download the failed job log first."
      };
    }
    const path = normalizePath(rest.join(" "));
    const log = await $.fs.read(path);
    const result = triageLog(log);
    const lines = [
      `category: ${result.category}`,
      `evidence: ${redact(result.evidence) || "none matched"}`,
      `action: ${result.action}`,
      result.stopLoop ? "stop: do not edit code for this failure; fix the environment or credentials first." : "continue: reproduce the failure locally before changing code."
    ];
    await $.store.set("lastCategory", result.category);
    return { text: truncate(lines.join("\n"), 2e3) };
  });
}
export {
  register
};
