// mods/design-patterns/src/lib/index.ts
var PATTERNS = [
  // creational
  {
    name: "Factory Method",
    category: "creational",
    useWhen: "choosing an implementation at runtime",
    idiom: "Record<Key, () => Impl> registry with satisfies"
  },
  {
    name: "Abstract Factory",
    category: "creational",
    useWhen: "creating families of matching objects",
    idiom: "object of factory functions typed by an interface"
  },
  {
    name: "Builder",
    category: "creational",
    useWhen: "many optional params or stepwise construction",
    idiom: "options object with defaults; fluent builder for ordered steps"
  },
  {
    name: "Prototype",
    category: "creational",
    useWhen: "copying configured objects",
    idiom: "structuredClone / spread / clone() method"
  },
  {
    name: "Singleton",
    category: "creational",
    useWhen: "one shared instance is required",
    idiom: "ES module export (the module cache is the singleton)"
  },
  // structural
  {
    name: "Adapter",
    category: "structural",
    useWhen: "an interface does not match what the client needs",
    idiom: "class or function implementing your port, wrapping the SDK"
  },
  {
    name: "Bridge",
    category: "structural",
    useWhen: "two independent dimensions vary",
    idiom: "inject the implementor interface"
  },
  {
    name: "Composite",
    category: "structural",
    useWhen: "trees / part-whole hierarchies",
    idiom: "recursive discriminated union or children arrays"
  },
  {
    name: "Decorator",
    category: "structural",
    useWhen: "adding behavior by wrapping",
    idiom: "higher-order function wrapping the same interface"
  },
  {
    name: "Facade",
    category: "structural",
    useWhen: "a simple API over a subsystem",
    idiom: "use-case service function or class"
  },
  {
    name: "Flyweight",
    category: "structural",
    useWhen: "sharing immutable intrinsic state",
    idiom: "Map cache of frozen objects"
  },
  {
    name: "Proxy",
    category: "structural",
    useWhen: "controlling access, laziness or caching",
    idiom: "wrapper class implementing the interface"
  },
  // behavioral
  {
    name: "Chain of Responsibility",
    category: "behavioral",
    useWhen: "ordered handlers that can short-circuit",
    idiom: "middleware arrays composed with reduceRight"
  },
  {
    name: "Command",
    category: "behavioral",
    useWhen: "a request needs queueing, retry or undo",
    idiom: "{ type, payload } objects + handler map; queue jobs"
  },
  {
    name: "Iterator",
    category: "behavioral",
    useWhen: "traversing without exposing internals",
    idiom: "[Symbol.iterator], generators, async generators"
  },
  {
    name: "Mediator",
    category: "behavioral",
    useWhen: "many-to-many coordination",
    idiom: "orchestrator service or typed event bus"
  },
  {
    name: "Memento",
    category: "behavioral",
    useWhen: "snapshot and restore state",
    idiom: "immutable snapshot types, structuredClone"
  },
  {
    name: "Observer",
    category: "behavioral",
    useWhen: "dependents need notifying",
    idiom: "typed EventEmitter / EventTarget / streams"
  },
  {
    name: "State",
    category: "behavioral",
    useWhen: "behavior changes with state and transitions",
    idiom: "discriminated union + transition table"
  },
  {
    name: "Strategy",
    category: "behavioral",
    useWhen: "algorithms are interchangeable",
    idiom: "function type (input) => output, Record map"
  },
  {
    name: "Template Method",
    category: "behavioral",
    useWhen: "a fixed skeleton with variable steps",
    idiom: "higher-order function taking step functions"
  },
  {
    name: "Visitor",
    category: "behavioral",
    useWhen: "new operations over stable node types",
    idiom: "discriminated union + exhaustive switch on kind"
  }
];
function findPattern(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = PATTERNS.find((p) => p.name.toLowerCase() === q);
  if (exact) return exact;
  return PATTERNS.find((p) => p.name.toLowerCase().includes(q)) ?? null;
}
function byCategory(category) {
  return PATTERNS.filter((p) => p.category === category);
}
function renderAnswer(args) {
  const q = args.trim();
  if (!q) {
    const lines = [
      "design-patterns: all 22 GoF patterns for TypeScript/Node and Ruby/Rails.",
      "Usage: /patterns <name> for one pattern, /patterns list <category>, or describe your problem:",
      "  /patterns strategy        - one pattern card",
      "  /patterns list behavioral - a category listing",
      '  /patterns "switch-on-type smells everywhere" - pick candidates from the selection table',
      "Skills: typescript-node-design-patterns, ruby-rails-design-patterns (full references)."
    ];
    return lines.join("\n");
  }
  if (q.startsWith("list")) {
    const cat = q.slice(4).trim().toLowerCase();
    if (cat === "creational" || cat === "structural" || cat === "behavioral") {
      const rows = byCategory(cat).map(
        (p) => `- ${p.name}: use when ${p.useWhen}. Idiom first: ${p.idiom}.`
      );
      return `design-patterns — ${cat} (${rows.length}):
${rows.join("\n")}`;
    }
    return "Usage: /patterns list creational|structural|behavioral";
  }
  const hit = findPattern(q);
  if (hit) {
    return [
      `design-patterns — ${hit.name} (${hit.category})`,
      `  Use when: ${hit.useWhen}.`,
      `  Idiom first: ${hit.idiom}.`,
      "  Full entry with implementation and tests: see the design-patterns skill references."
    ].join("\n");
  }
  const candidates = matchByProblem(q);
  if (candidates.length > 0) {
    const rows = candidates.map((p) => `- ${p.name}: ${p.useWhen}`);
    return [
      `No pattern named "${args.trim()}". Based on the problem, consider:`,
      ...rows,
      "Run /patterns <name> for details."
    ].join("\n");
  }
  return `No pattern named "${args.trim()}". Try /patterns with no arguments to see usage, or /patterns list <category>.`;
}
var PROBLEM_KEYWORDS = [
  { words: ["switch", "type", "instanceof"], pattern: "Visitor" },
  { words: ["if", "else", "chain", "long"], pattern: "Strategy" },
  { words: ["wrap", "middleware", "cross-cutting"], pattern: "Decorator" },
  { words: ["queue", "retry", "undo", "job"], pattern: "Command" },
  { words: ["tree", "hierarchy", "part-whole", "nested"], pattern: "Composite" },
  { words: ["state", "lifecycle", "transition", "status"], pattern: "State" },
  { words: ["notify", "subscribe", "event", "listen"], pattern: "Observer" },
  { words: ["sdk", "third-party", "vendor", "api client"], pattern: "Adapter" },
  { words: ["one instance", "shared", "global"], pattern: "Singleton" },
  { words: ["cache", "lazy", "access control"], pattern: "Proxy" },
  { words: ["steps", "skeleton", "algorithm outline"], pattern: "Template Method" }
];
function matchByProblem(text) {
  const t = text.toLowerCase();
  const names = new Set(
    PROBLEM_KEYWORDS.filter((k) => k.words.some((w) => t.includes(w))).map((k) => k.pattern)
  );
  return PATTERNS.filter((p) => names.has(p.name)).slice(0, 5);
}

// mods/design-patterns/src/register.tsx
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "patterns",
      description: "Look up a GoF pattern, list a category, or describe a problem to get candidates"
    });
    return next(e);
  });
  on("command.run", { command: "patterns" }, async (_$, e) => {
    return { text: renderAnswer(typeof e.args === "string" ? e.args : "") };
  });
}
export {
  register
};
