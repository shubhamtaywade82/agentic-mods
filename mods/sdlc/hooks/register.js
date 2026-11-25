// mods/sdlc/src/lib/commands.ts
var COMMANDS = [
  {
    name: "sdlc-init",
    description: "Bootstrap SDLC scaffolding in this repo (AGENTS.md, docs/, plan template)"
  },
  { name: "sdlc-feature", description: "Full feature workflow from idea to PR (all gates)" },
  { name: "sdlc-prd", description: "Stage 01: clarify an idea and write docs/prd/<slug>.md" },
  {
    name: "sdlc-spec",
    description: "Stage 02: turn the PRD into docs/specs/<slug>.md (+ ADR if needed)"
  },
  { name: "sdlc-plan", description: "Stage 03: break the spec into docs/plans/<slug>.md" },
  { name: "sdlc-tdd", description: "Stage 04: implement the next planned task with strict TDD" },
  { name: "sdlc-review", description: "Stage 05: review the branch diff against the checklists" },
  { name: "sdlc-debug", description: "Stage 06: root-cause a bug with a hypothesis-driven method" },
  { name: "sdlc-refactor", description: "Stage 07: refactor safely behind green tests" },
  { name: "sdlc-ship", description: "Stage 08: verify, draft the PR body and changelog entry" },
  {
    name: "sdlc-audit",
    description: "Security audit of a feature or area against the OWASP checklist"
  }
];
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
}
function buildCommandPrompt(name, args) {
  const topic = args.trim();
  const slug = slugify(topic || "feature");
  const t = topic || "<describe the feature or problem here>";
  switch (name) {
    case "sdlc-init":
      return [
        "Bootstrap the SDLC kit in this repository.",
        "1. If AGENTS.md does not exist, create it with these sections:",
        "   project context, operating principles, code standards, testing rules, git/PR rules,",
        '   safety boundaries, definition of done, report format. Mark assumptions with "# ADJUST".',
        "2. Create docs/{prd,specs,plans,adr}/ and a docs/TODO.md.",
        "3. If a CLAUDE.md exists, add one line pointing at AGENTS.md as the source of truth.",
        '4. Report every file created and every "# ADJUST" line the user must review. Do not',
        "   overwrite any existing file."
      ].join("\n");
    case "sdlc-feature":
      return [
        `Build this feature end-to-end: ${t}`,
        "",
        "Work through these stages in order, pausing for my approval at each gate:",
        "1. Clarify (planner) -> docs/prd/" + slug + ".md  [gate: I approve acceptance criteria]",
        "2. Spec (architect) -> docs/specs/" + slug + ".md  [gate: I approve the design]",
        "3. Plan (planner) -> docs/plans/" + slug + ".md  [gate: I approve the tasks]",
        "4. Create branch feat/" + slug + ". For each task: implementer (TDD), one commit per task.",
        "5. Review (reviewer + security if relevant) in a fresh context; fix Blockers/Majors.",
        "6. Draft the PR body and show it to me before opening the PR."
      ].join("\n");
    case "sdlc-prd":
      return [
        `Clarify and write a PRD for: ${t}`,
        "- Ask me up to 5 clarifying questions first (users, scope, edge cases, non-goals, success metric).",
        `- Then draft docs/prd/${slug}.md: problem, users, goals, acceptance criteria, non-goals, open questions.`,
        "- Acceptance criteria in Given/When/Then, each independently testable.",
        "- Explicit out-of-scope list and open questions at the end.",
        "Do not write any code."
      ].join("\n");
    case "sdlc-spec":
      return [
        `Write a tech spec for: ${t}`,
        `- Read the PRD (docs/prd/${slug}.md or the one I point at) and explore the codebase first;`,
        "  list the files you read and the patterns you will reuse.",
        `- Draft docs/specs/${slug}.md: context, design, data model, API contracts, risks, test strategy.`,
        "- For each significant decision: 2-3 options, trade-offs, a recommendation.",
        "- Cover data model, API contracts, failure modes, security, performance, rollout, test strategy.",
        "- Record major decisions as ADRs in docs/adr/. Do not write implementation code."
      ].join("\n");
    case "sdlc-plan":
      return [
        `Create a task plan for: ${t}`,
        `- Read docs/specs/${slug}.md (or the spec I point at), then write docs/plans/${slug}.md.`,
        "- Tasks: max ~200 line diff each, dependency-ordered, one commit each, own test(s).",
        "- Each task lists goal, files, the failing test to write first, and done-criteria.",
        "- Mark parallelizable tasks [P]. End with an integration/e2e task and a docs task.",
        "Show me the plan and wait for approval."
      ].join("\n");
    case "sdlc-tdd":
      return [
        "Implement the next task in the plan with strict TDD.",
        `Plan: ${topic || "the current plan in docs/plans/ (newest file)"}.`,
        "Steps:",
        "1. State the task and the files you will touch.",
        "2. Red: write the failing test, run it, show the failure.",
        "3. Green: minimum code to pass. Run the test.",
        "4. Refactor with tests green, then run the full relevant suite + lint + type-check.",
        "5. Commit with a conventional message and tick the task in the plan.",
        "Stop and ask me if the spec looks wrong or the task grows beyond 2x the estimate."
      ].join("\n");
    case "sdlc-review":
      return [
        "Review the current branch diff.",
        "Scope: " + (topic || "git diff main...HEAD"),
        "Steps:",
        "- Check the diff against the spec: correctness, error handling, naming, tests, scope creep.",
        "- Output findings as: Severity (Blocker/Major/Minor/Nit) | file:line | issue | fix.",
        "- If the diff touches auth, input, data, payments or files, also check it against the OWASP Top 10.",
        "- List missing tests and spec mismatches. Verdict: Approve or Request changes.",
        "No praise, no full rewrites; be specific and actionable."
      ].join("\n");
    case "sdlc-debug":
      return [
        `Root-cause and fix this bug: ${t}`,
        "Steps:",
        "1. Reproduce: exact steps, expected vs actual, full error.",
        "2. Isolate the smallest failing case and write it as a failing test.",
        "3. List 3 ranked hypotheses, then test them one at a time.",
        "4. Fix the root cause minimally; prove it with the regression test + full suite.",
        "Do not patch before hypotheses are tested. Never hide errors with try/catch or sleeps."
      ].join("\n");
    case "sdlc-refactor":
      return [
        `Refactor: ${t}`,
        "Steps:",
        "1. Ensure the current behavior is covered; add characterization tests if not.",
        "2. State the smell and the target design in one paragraph.",
        "3. Refactor in tiny steps, running tests after each; no behavior change.",
        "4. Keep refactor commits separate from feature commits."
      ].join("\n");
    case "sdlc-ship":
      return [
        "Prepare this work for shipping.",
        "1. Run full tests, lint, type-check; stop and report if anything fails.",
        "2. Self-review: tests cover the change, no debug code, docs and config updated, no secrets.",
        "3. Draft the PR body (summary, changes, verification, risks) and a CHANGELOG entry.",
        "4. Show me both. Only push/open the PR after I confirm.",
        ...topic ? [`Scope: ${t}`] : []
      ].join("\n");
    case "sdlc-audit":
      return [
        `Security audit: ${t}`,
        "- Audit against the OWASP Top 10 and report findings",
        "  as: severity, location, exploit scenario, concrete fix.",
        "- Cover input validation, injection, authn/authz, secrets, data exposure, dependencies.",
        "- Run the dependency audit tools available for this stack.",
        "Do not modify code until I approve the fixes."
      ].join("\n");
    default:
      return `Unknown sdlc command: ${name}`;
  }
}

// mods/sdlc/src/register.tsx
function register(on) {
  on("session.start", async ($, e, next) => {
    for (const c of COMMANDS) {
      await $.command.register({ name: c.name, description: c.description });
    }
    return next(e);
  });
  for (const c of COMMANDS) {
    on("command.run", { command: c.name }, async (_$, e) => {
      const args = typeof e.args === "string" ? e.args : "";
      return { text: buildCommandPrompt(c.name, args) };
    });
  }
}
export {
  register
};
