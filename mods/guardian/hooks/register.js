// mods/guardian/src/lib/blast.ts
var isProdDb = (cmd) => /\b(?:prod(?:uction)?|live|primary)\b/i.test(cmd);
var RULES = [
  {
    kind: "rm-rf",
    why: "recursively force-deletes files; recovery is impossible in most setups",
    test: (c) => /(^|[\s;&|])(rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b|rm\s+-rf\b)/.test(c) || /rm\s+--recursive\s+--force/.test(c)
  },
  {
    kind: "force-push",
    why: "overwrites remote history; other contributors lose commits",
    test: (c) => /git\s+push\b[^\n]*\s(-f\b|--force\b)/.test(c) && !/force-with-lease/.test(c)
  },
  {
    kind: "history-rewrite",
    why: "rewrites history or drops commits on the current branch",
    test: (c) => /git\s+(filter-branch|rebase\b[^\n]*--root|reflog\s+expire\b[^\n]*--expire=now)/.test(c)
  },
  {
    kind: "drop-database",
    why: "drops an entire database",
    test: (c) => /\bDROP\s+DATABASE\b/i.test(c) || /--drop-database/.test(c)
  },
  {
    kind: "prod-db-write",
    why: "writes to what looks like a production database",
    test: (c) => isProdDb(c) && /\b(?:psql|mysql|psqlpg|pg_restore|pg_dump|redis-cli|mongo|mongosh)\b/.test(c)
  },
  {
    kind: "db-migration",
    why: "runs a database migration, which changes schema irreversibly",
    test: (c) => /\b(?:bin\/rails\s+db:(?:migrate|reset|drop)|npx\s+prisma\s+migrate\s+(?:deploy|reset|dev)|python\s+manage\.py\s+migrate|alembic\s+upgrade)\b/.test(c)
  },
  {
    kind: "chmod-777-root",
    why: "makes a system-wide path world-writable",
    test: (c) => /chmod\s+-R\s+777\s+\//.test(c)
  },
  {
    kind: "dd-to-device",
    why: "raw-writes to a disk device",
    test: (c) => /\bdd\b[^\n]*\bof=\/dev\/(?:disk|sd|nvme|hd)/.test(c)
  },
  {
    kind: "git-clean-force",
    why: "force-deletes all untracked files and directories",
    test: (c) => /git\s+clean\b[^\n]*-(?:[a-zA-Z]*f)/.test(c)
  }
];
function checkCommand(cmd) {
  if (!cmd) return null;
  for (const r of RULES) {
    if (r.test(cmd)) return { kind: r.kind, why: r.why };
  }
  return null;
}
function denyMessage(m) {
  return `guardian blocked this command (${m.kind}): ${m.why}. If you really intend this, run it yourself in a terminal, or ask the user to disable guardian for this call.`;
}

// mods/guardian/src/lib/secrets.ts
var PATTERNS = [
  // AKIA followed by 16 uppercase letters/digits
  { kind: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  // GitHub personal access tokens (classic ghp_, fine-grained github_pat_)
  { kind: "github-pat", regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  // xoxb-/xoxp-/xoxa- style Slack tokens
  { kind: "slack-token", regex: /\bxox[abpori]-[A-Za-z0-9-]{10,}\b/g },
  // Google API keys: AIza...
  { kind: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // PEM private key headers (with or without the RSA/EC marker)
  { kind: "private-key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  // Generic bearer tokens of real length
  { kind: "generic-bearer", regex: /\b(?:Bearer|bearer)\s+[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}/g },
  // AWS secret access keys assigned in env-style text (40 chars base64ish)
  { kind: "aws-secret-key", regex: /\b[A-Za-z0-9/+=]{40}\b/g },
  // TOKEN=..., PASSWORD=..., SECRET=... assignments with a non-empty value
  { kind: "env-assignment", regex: /\b(?:API_KEY|TOKEN|PASSWORD|PASSWD|SECRET|ACCESS_KEY|PRIVATE_TOKEN)[A-Z_]*\s*[:=]\s*['"]?[^\s'"]{8,}/g }
];
var HIGH_SIGNAL = /* @__PURE__ */ new Set([
  "aws-access-key",
  "github-pat",
  "slack-token",
  "google-api-key",
  "private-key"
]);
function isHighSignal(kind) {
  return HIGH_SIGNAL.has(kind);
}
function scan(text) {
  if (!text) return [];
  const out = [];
  for (const p of PATTERNS) {
    const re = new RegExp(p.regex.source, p.regex.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) break;
      out.push({ kind: p.kind, value: m[0], index: m.index });
      if (out.length >= 100) break;
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
function redact(text, findings) {
  if (findings.length === 0) return text;
  const spans = [];
  for (const f of findings) {
    const start = f.index;
    const end = f.index + f.value.length;
    const prev = spans[spans.length - 1];
    if (prev && start <= prev.end) continue;
    spans.push({ start, end, kind: f.kind });
  }
  let out = "";
  let cursor = 0;
  for (const s of spans) {
    out += text.slice(cursor, s.start);
    out += `[redacted:${s.kind}]`;
    cursor = s.end;
  }
  out += text.slice(cursor);
  return out;
}
function hasHighSignal(findings) {
  return findings.some((f) => isHighSignal(f.kind));
}
function denyReason(findings) {
  const high = findings.filter((f) => isHighSignal(f.kind));
  if (high.length === 0) return null;
  const kinds = [...new Set(high.map((f) => f.kind))].join(", ");
  return `guardian: refusing this call - it would expose what looks like a real secret (${kinds}). Move the value into an environment variable or secret manager and rewrite the command.`;
}
function summarize(findings) {
  const out = {};
  for (const f of findings) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
}

// mods/guardian/src/lib/gate.ts
function holdForBlast(command, match) {
  return {
    command,
    reason: "destructive-command",
    preview: `This command (${match.kind}) ${match.why}. Review the impact above before approving. If you did not expect this, deny it.`,
    previewComputed: true
  };
}
function holdForSecretDiff(command, kinds, diffStat2) {
  const kindList = [...new Set(kinds)].join(", ");
  const preview = `The staged diff this command would commit/push contains what looks like a real secret (${kindList}). Diff: ${diffStat2.files} file(s), +${diffStat2.insertions}/-${diffStat2.deletions}. Approving writes the secret into git history. Move the value to an env var or secret manager and re-stage instead.`;
  return {
    command,
    reason: "diff-contains-secret",
    preview,
    previewComputed: true
  };
}
function holdForOversizedDiff(command, bytes, limit) {
  return {
    command,
    reason: "diff-oversized",
    preview: `The staged diff is ${bytes} bytes, above the scan limit of ${limit}. guardian will not approve a diff it could not inspect. Stage smaller hunks or split the commit.`,
    previewComputed: false
  };
}
function decideNoninteractive(op) {
  void op;
  return "deny";
}
function isHistoryMutating(command) {
  return /\bgit\s+(commit|push|tag|merge\s+--(no-)?ff|rebase)\b/.test(command);
}
var DEFAULT_DIFF_LIMIT = 256 * 1024;
function diffStat(diff) {
  if (!diff) return { files: 0, insertions: 0, deletions: 0 };
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      if (line.startsWith("+++") && line !== "+++") files += 0;
      continue;
    }
    if (line.startsWith("diff --git")) {
      files += 1;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) insertions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  if (files === 0) {
    files = diff.split("\n").filter((l) => l.startsWith("+++ b/")).length;
  }
  return { files, insertions, deletions };
}

// mods/guardian/src/register.tsx
var stats = {
  commandsBlocked: 0,
  commandsHeld: 0,
  commandsApproved: 0,
  secretsRedacted: 0,
  writesBlocked: 0,
  resultsRedacted: 0,
  kinds: {}
};
function mergeKinds(kinds) {
  for (const [k, n] of Object.entries(kinds)) stats.kinds[k] = (stats.kinds[k] ?? 0) + n;
}
async function requestApproval($, command, _reason, preview) {
  try {
    const decision = await $.ui.ask(`guardian: ${command}
${preview}`, ["approve", "deny"]);
    return decision === "approve" ? "approve" : "deny";
  } catch {
    return "deny";
  }
}
async function gateHistoryCommand($, command) {
  let diffText = "";
  try {
    const res = await $.process.run(["git", "diff", "--cached"]);
    diffText = res.stdout ?? "";
  } catch {
    stats.commandsBlocked += 1;
    return { deny: "guardian: could not inspect the staged diff for secrets; refusing this commit/push. Stage the diff and retry." };
  }
  if (diffText.length > DEFAULT_DIFF_LIMIT) {
    stats.commandsHeld += 1;
    const held2 = holdForOversizedDiff(command, diffText.length, DEFAULT_DIFF_LIMIT);
    const decision2 = await requestApproval($, held2.command, "diff-oversized", held2.preview);
    if (decision2 === "approve") return null;
    stats.commandsBlocked += 1;
    return { deny: held2.preview };
  }
  const findings = scan(diffText);
  if (findings.length === 0) return null;
  if (hasHighSignal(findings)) {
    stats.commandsBlocked += 1;
    const stat2 = diffStat(diffText);
    const held2 = holdForSecretDiff(
      command,
      findings.filter((f) => hasHighSignal([f])).map((f) => f.kind),
      stat2
    );
    return { deny: held2.preview };
  }
  stats.commandsHeld += 1;
  const stat = diffStat(diffText);
  const held = holdForSecretDiff(
    command,
    findings.map((f) => f.kind),
    stat
  );
  const decision = await requestApproval($, held.command, "diff-contains-secret", held.preview);
  if (decision === "approve") {
    stats.commandsApproved += 1;
    return null;
  }
  stats.commandsBlocked += 1;
  return { deny: decideNoninteractive(held) === "approve" ? "" : held.preview };
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "guardian-report",
      description: "Show what guardian has blocked, held or redacted this session"
    });
    return next(e);
  });
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const command = typeof e.command === "string" ? e.command : "";
    const blast = checkCommand(command);
    if (blast) {
      stats.commandsHeld += 1;
      const held = holdForBlast(command, blast);
      const decision = await requestApproval($, held.command, "destructive-command", held.preview);
      if (decision === "approve") {
        stats.commandsApproved += 1;
        return next(e);
      }
      stats.commandsBlocked += 1;
      return { deny: denyMessage(blast) };
    }
    const cmdFindings = scan(command);
    if (cmdFindings.length > 0) {
      mergeKinds(summarize(cmdFindings));
      if (denyReason(cmdFindings)) {
        stats.commandsBlocked += 1;
        return { deny: denyReason(cmdFindings) ?? "guardian: refusing this call" };
      }
      stats.secretsRedacted += cmdFindings.length;
      return next({ ...e, command: redact(command, cmdFindings) });
    }
    if (isHistoryMutating(command)) {
      const gate = await gateHistoryCommand($, command);
      if (gate) return gate;
    }
    return next(e);
  }).catch(async (_$) => {
    return { deny: "guardian failed; refusing this call" };
  });
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const content = typeof e.content === "string" ? e.content : "";
    const findings = scan(content);
    if (findings.length > 0) {
      if (hasHighSignal(findings)) {
        stats.writesBlocked += 1;
        return { deny: denyReason(findings) ?? "guardian: refusing this write" };
      }
      stats.secretsRedacted += findings.length;
      mergeKinds(summarize(findings));
      return next({ ...e, content: redact(content, findings) });
    }
    return next(e);
  }).catch(async (_$) => {
    return { deny: "guardian failed; refusing this write" };
  });
  on("command.run", { command: "guardian-report" }, async () => {
    const kinds = Object.entries(stats.kinds).map(([k, n]) => `${k} x${n}`).join(", ");
    return {
      text: `guardian session report: ${stats.commandsBlocked} commands blocked, ${stats.commandsHeld} held for approval (${stats.commandsApproved} approved), ${stats.writesBlocked} writes blocked, ${stats.secretsRedacted} secrets redacted in calls/writes, ${stats.resultsRedacted} secrets redacted in tool results` + (kinds ? ` (${kinds})` : "")
    };
  });
}
export {
  register
};
