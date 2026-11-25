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

// mods/response-modes/src/register.tsx
var STYLE_TEXT = {
  tldr: "Answer in at most five sentences. Lead with the decision or the result, then the one detail the reader needs.",
  simple: "Write in plain language: short sentences, no unexplained jargon. Define a technical term in a few words the first time you use it."
};
var COMMANDS = [
  ["tldr", "Concise responses: five sentences at most"],
  ["mode-simple", "Plain-language responses"],
  ["mode-off", "Return to the default response style"]
];
var CONFIRMATION = {
  tldr: "Concise response style on.",
  simple: "Plain-language response style on.",
  off: "Default response style restored."
};
async function setStyle($, style) {
  if (style === null) await $.store.delete("style");
  else await $.store.set("style", style);
  return { text: CONFIRMATION[style ?? "off"] };
}
function register(on) {
  on("session.start", async ($, e, next) => {
    for (const [name, description] of COMMANDS) {
      await registerCommand($, { name, description });
    }
    const sessionId = await $.session.id();
    if (await $.store.get("sessionId") !== sessionId) {
      await $.store.set("sessionId", sessionId);
      await $.store.delete("style");
    }
    return next(e);
  });
  on("command.run", { command: "tldr" }, ($) => setStyle($, "tldr"));
  on("command.run", { command: "mode-simple" }, ($) => setStyle($, "simple"));
  on("command.run", { command: "mode-off" }, ($) => setStyle($, null));
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    const style = await $.store.get("style");
    if (style !== "tldr" && style !== "simple") return composed;
    return {
      sections: [
        ...composed.sections,
        { id: "response-modes:style", text: STYLE_TEXT[style], scope: "session" }
      ]
    };
  });
}
export {
  register
};
