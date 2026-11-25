// mods/mod-template/src/lib/counter.ts
var AttemptCounter = class {
  count = 0;
  increment() {
    this.count += 1;
    return this.count;
  }
  get value() {
    return this.count;
  }
  reset() {
    this.count = 0;
  }
};
var LABELS = {
  counter: "tool-call attempts",
  tally: (n) => `Claude has made ${n} tool-call attempts since this mod loaded`
};

// mods/mod-template/src/lib/usage.ts
function formatUsage(u) {
  const tokens = finiteOr(0, u?.context?.tokens);
  const window = finiteOr(0, u?.context?.window);
  const limits = Array.isArray(u?.rateLimits) ? u.rateLimits : [];
  const limitText = limits.length ? limits.map((l) => `${l.kind} ${finiteOr(0, l?.percentUsed)}% used`).join(", ") : "no plan-limit data";
  return `context: ${tokens}/${window} tokens; ${limitText}`;
}
function finiteOr(fallback, v) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

// packages/core/src/util.ts
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
async function registerCommand(host, spec) {
  try {
    await host.command.register(spec);
    return true;
  } catch (error) {
    host.ui.toast(`/${spec.name} is unavailable: ${errorMessage(error)}`);
    return false;
  }
}

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// mods/mod-template/src/register.tsx
var counter = new AttemptCounter();
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "mod-template-tally",
      description: "Show how many tool-call attempts Claude has made"
    });
    await registerCommand($, {
      name: "mod-template-usage",
      description: "Show context and plan-limit usage"
    });
    return next(e);
  });
  on("tool.call", async ($, e, next) => {
    counter.increment();
    $.ui.invalidate("ui.render");
    return next(e);
  }).catch(async () => void 0);
  on("command.run", { command: "mod-template-tally" }, async () => {
    return { text: LABELS.tally(counter.value) };
  });
  on("command.run", { command: "mod-template-usage" }, async ($) => {
    const u = await $.session.usage();
    return { text: formatUsage(u) };
  });
  on("ui.render", { component: "Spinner" }, async (_$, e, next) => {
    return next({
      ...e,
      props: { ...e.props, suffix: ` · ${LABELS.counter}: ${counter.value}…` }
    });
  });
}
export {
  register
};
