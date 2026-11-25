// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";
var PathGuardError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PathGuardError";
  }
};
function normalizePath(input) {
  let path = input.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  return path;
}
function isAbsolutePath(path) {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}
function hasParentSegment(path) {
  return normalizePath(path).split("/").includes("..");
}
function stateRelativePath(relative) {
  const path = normalizePath(relative);
  if (path === "" || isAbsolutePath(path) || hasParentSegment(path)) {
    throw new PathGuardError(`refusing a state path outside ${STATE_DIR}: ${relative}`);
  }
  return `${STATE_DIR}/${path}`;
}

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// packages/core/src/log.ts
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// packages/core/src/records.ts
function transitionLesson(current, action) {
  if (current === "proposed") {
    if (action === "approve") return "approved";
    if (action === "reject") return "rejected";
    return null;
  }
  if (current === "approved" && action === "retire") return "rejected";
  if (current === "stale" && action === "retire") return "rejected";
  if (current === "approved" && action === "reject") return null;
  return null;
}
function staleLinks(lesson, current) {
  return lesson.links.filter((link) => {
    if (!current.has(link.path)) return true;
    return current.get(link.path) !== link.fingerprint;
  }).map((link) => link.path);
}

// mods/learning-ledger/src/register.tsx
var FILE = "ledger.json";
async function loadLessons($) {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath(FILE)));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function saveLessons($, lessons) {
  await $.fs.write(stateRelativePath(FILE), `${JSON.stringify(lessons, null, 2)}
`);
}
async function fingerprintsOf($, paths) {
  const out = /* @__PURE__ */ new Map();
  for (const path of paths) {
    try {
      out.set(path, await sha256Hex(await $.fs.read(path)));
    } catch {
      out.set(path, null);
    }
  }
  return out;
}
function nextId(lessons) {
  return `L-${String(lessons.length + 1).padStart(3, "0")}`;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "lesson",
      description: "Repository lessons: /lesson propose <text> | <paths>, approve|reject|retire <id>, check"
    });
    return next(e);
  });
  on("command.run", { command: "lesson" }, async ($, e) => {
    const [subcommand = "check", ...rest] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    const lessons = await loadLessons($);
    if (subcommand === "propose") {
      const body = rest.join(" ");
      const [textPart = "", pathPart = ""] = body.split("|").map((part) => part.trim());
      if (textPart === "")
        return { text: "Usage: /lesson propose <text> | <comma-separated repository paths>" };
      const links = pathPart.split(",").map((path) => path.trim()).filter((path) => path.length > 0);
      const fingerprints = await fingerprintsOf($, links);
      const lesson = {
        id: nextId(lessons),
        text: truncate(textPart, 500),
        scope: links,
        links: links.map((path) => ({ path, fingerprint: fingerprints.get(path) ?? null })),
        status: "proposed",
        createdAt: await $.clock.now()
      };
      await saveLessons($, [...lessons, lesson]);
      return { text: `${lesson.id} proposed. It is not used until approved.` };
    }
    if (subcommand === "approve" || subcommand === "reject" || subcommand === "retire") {
      const id = rest[0] ?? "";
      const target = lessons.find((lesson) => lesson.id === id);
      if (target === void 0) return { text: `No lesson ${id}.` };
      const action = subcommand === "approve" ? "approve" : subcommand === "reject" ? "reject" : "retire";
      const next = transitionLesson(target.status, action);
      if (next === null) return { text: `${id} is ${target.status}; ${action} does not apply.` };
      const links = action === "approve" ? await fingerprintsOf(
        $,
        target.links.map((link) => link.path)
      ) ?? /* @__PURE__ */ new Map() : null;
      const updated = {
        ...target,
        status: next,
        links: links === null ? target.links : target.links.map((link) => ({
          path: link.path,
          fingerprint: links.get(link.path) ?? null
        }))
      };
      await saveLessons(
        $,
        lessons.map((lesson) => lesson.id === id ? updated : lesson)
      );
      return { text: `${id} is now ${next}.` };
    }
    const approved = lessons.filter(
      (lesson) => lesson.status === "approved" || lesson.status === "stale"
    );
    const lines = [];
    for (const lesson of approved) {
      const current = await fingerprintsOf(
        $,
        lesson.links.map((link) => link.path)
      );
      const stale = staleLinks(lesson, current);
      if (stale.length > 0) lines.push(`${lesson.id} stale: ${stale.join(", ")} changed; review it`);
    }
    return {
      text: lines.length === 0 ? `${approved.length} approved lesson(s), none stale.` : lines.join("\n")
    };
  });
}
export {
  register
};
