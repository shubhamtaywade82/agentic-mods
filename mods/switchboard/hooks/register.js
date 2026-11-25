// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

// packages/core/src/coordination.ts
function claimPath(claims, claim, ttlMs, now) {
  const fresh = pruneClaims(claims, ttlMs, now);
  const holder = fresh.find(
    (existing) => existing.path === claim.path && existing.sessionId !== claim.sessionId
  );
  if (holder !== void 0) return { claims: fresh, conflict: holder };
  const others = fresh.filter(
    (existing) => !(existing.path === claim.path && existing.sessionId === claim.sessionId)
  );
  return { claims: [...others, { ...claim, at: now }], conflict: null };
}
function pruneClaims(claims, ttlMs, now) {
  return claims.filter((claim) => now - claim.at <= ttlMs);
}

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// mods/switchboard/src/register.tsx
var TTL_MS = 30 * 60 * 1e3;
async function storedClaims($) {
  const value = await $.store.get("claims");
  return Array.isArray(value) ? value : [];
}
async function claimFile($, path) {
  const sessionId = await $.session.id();
  const now = await $.clock.now();
  const result = claimPath(
    await storedClaims($),
    { path, sessionId, owner: sessionId, at: now },
    TTL_MS,
    now
  );
  await $.store.set("claims", result.claims);
  if (result.conflict !== null && result.conflict.sessionId !== sessionId) {
    $.ui.toast(`switchboard: ${path} was claimed by session ${result.conflict.sessionId} recently`);
  }
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "switchboard",
      description: "List file claims across sessions, or /switchboard send <session> <text>"
    });
    return next(e);
  });
  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    await claimFile($, e.file_path);
    return next(e);
  });
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    await claimFile($, e.file_path);
    return next(e);
  });
  on("command.run", { command: "switchboard" }, async ($, e) => {
    const [subcommand = "", target = "", ...words] = e.args.trim().split(/\s+/);
    if (subcommand === "send") {
      const text = words.join(" ").trim();
      if (target === "" || text === "") {
        return { text: "Usage: /switchboard send <session id> <message>" };
      }
      await $.session.send({ to: { sessionId: target }, text });
      return { text: `Message sent to session ${target}.` };
    }
    const now = await $.clock.now();
    const fresh = pruneClaims(await storedClaims($), TTL_MS, now);
    if (fresh.length === 0) return { text: "No file claims in the last 30 minutes." };
    const lines = fresh.map(
      (claim) => `${claim.path} · session ${claim.sessionId} · ${Math.round((now - claim.at) / 6e4)} min ago`
    );
    return { text: lines.join("\n") };
  });
}
export {
  register
};
