// mods/pulse/src/lib/stats.ts
var ToolStats = class {
  tally = {};
  total = 0;
  maxTools;
  constructor(maxTools = 50) {
    this.maxTools = maxTools;
  }
  record(tool) {
    this.total += 1;
    if (this.tally[tool] !== void 0 || Object.keys(this.tally).length < this.maxTools) {
      this.tally[tool] = (this.tally[tool] ?? 0) + 1;
    }
  }
  snapshot() {
    const perTool = Object.entries(this.tally).map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
    return { attempts: this.total, perTool };
  }
  reset() {
    for (const k of Object.keys(this.tally)) delete this.tally[k];
    this.total = 0;
  }
};
function pressureBand(ratio) {
  if (!Number.isFinite(ratio)) return "ok";
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.5) return "caution";
  return "ok";
}
function contextLine(tokens, window) {
  const t = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  const w = Number.isFinite(window) && window > 0 ? window : 0;
  const pct = w > 0 ? Math.round(t / w * 100) : 0;
  return `context ${t}/${w} (${pct}%, ${pressureBand(w > 0 ? t / w : 0)})`;
}
function spinnerSuffix(attempts, tokens, window) {
  return ` · pulse: ${attempts} calls, ${contextLine(tokens, window)}`;
}
function report(stats2, tokens, window) {
  const lines = [
    `pulse session report`,
    `  tool-call attempts: ${stats2.attempts}`,
    `  ${contextLine(tokens, window)}`
  ];
  if (stats2.perTool.length > 0) {
    lines.push("  per tool:");
    for (const { tool, count } of stats2.perTool) {
      lines.push(`    ${tool.padEnd(12)} ${count}`);
    }
  } else {
    lines.push("  per tool: (none yet)");
  }
  return lines.join("\n");
}

// mods/pulse/src/register.tsx
var stats = new ToolStats();
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "pulse-report",
      description: "Show per-tool call tally and context pressure for this session"
    });
    await $.command.register({
      name: "pulse-usage",
      description: "Show a one-line context-window usage readout"
    });
    return next(e);
  });
  on("tool.call", async ($, e, next) => {
    stats.record(typeof e?.tool === "string" ? e.tool : "unknown");
    $.ui.invalidate("ui.render");
    return next(e);
  }).catch(async () => void 0);
  on("ui.render", { component: "Spinner" }, async ($, e, next) => {
    let tokens = 0;
    let window = 0;
    try {
      const u = await $.session.usage();
      tokens = u?.context?.tokens ?? 0;
      window = u?.context?.window ?? 0;
    } catch {
    }
    return next({
      ...e,
      props: { ...e.props, suffix: spinnerSuffix(stats.snapshot().attempts, tokens, window) }
    });
  });
  on("command.run", { command: "pulse-report" }, async ($) => {
    let tokens = 0;
    let window = 0;
    try {
      const u = await $.session.usage();
      tokens = u?.context?.tokens ?? 0;
      window = u?.context?.window ?? 0;
    } catch {
    }
    return { text: report(stats.snapshot(), tokens, window) };
  });
  on("command.run", { command: "pulse-usage" }, async ($) => {
    let t = 0;
    let w = 0;
    try {
      const u = await $.session.usage();
      t = u?.context?.tokens ?? 0;
      w = u?.context?.window ?? 0;
    } catch {
    }
    const pct = w > 0 ? Math.round(t / w * 100) : 0;
    return { text: `context ${t}/${w} tokens (${pct}% used)` };
  });
}
export {
  register
};
