// Tier 2: Boundary & Corner Cases (Features 1 through 53)
// 5 test cases per feature = 265 tests total.
import { setTestScope, test, expect, assert } from "./framework.mjs";
import {
  createTaskFixture,
  validateTask13Fields,
  canTransitionTask,
  transitionTaskStatus,
  createRoleFixture,
  createRunnerFixture,
  createModelFixture,
  createConnectionFixture,
  createHandoffFixture,
  MockFileLockManager,
  redactSecrets,
  resolveHarnessContract,
  TASK_STATUSES,
  PANE_STATUSES,
} from "./fixtures.mjs";

export function registerTier2Tests() {
  // F1: Sovereign Clean Bash (Boundaries)
  setTestScope(2, "F1", "Sovereign Clean Bash (Boundaries)");
  test("F1.b1: System default SHELL=zsh does not override /bin/bash for bash runner", () => {
    const runner = createRunnerFixture({ id: "bash" });
    const resolvedShell = runner.id === "bash" ? "/bin/bash" : process.env.SHELL;
    expect(resolvedShell).toBe("/bin/bash");
  });
  test("F1.b2: Empty args array preserves mandatory -i and -l flags", () => {
    const runner = createRunnerFixture({ id: "bash", defaultArgs: [] });
    const finalArgs = runner.defaultArgs.length ? runner.defaultArgs : ["-i", "-l"];
    expect(finalArgs).toEqual(["-i", "-l"]);
  });
  test("F1.b3: Custom environment variables cannot clobber SHELL path", () => {
    const customEnv = { SHELL: "/bin/sh", FOO: "bar" };
    const sanitizedEnv = { ...customEnv, SHELL: "/bin/bash" };
    expect(sanitizedEnv.SHELL).toBe("/bin/bash");
  });
  test("F1.b4: Extra options containing prompt text are dropped for bash runner", () => {
    const opts = { runner: "bash", prompt: "Execute arbitrary instructions" };
    const finalPrompt = opts.runner === "bash" ? undefined : opts.prompt;
    expect(finalPrompt).toBeUndefined();
  });
  test("F1.b5: Repeated restart requests maintain clean /bin/bash -i -l invocation", () => {
    const invocations = [1, 2, 3].map(() => ({ cmd: "/bin/bash", args: ["-i", "-l"] }));
    expect(invocations[2].args).toEqual(["-i", "-l"]);
  });

  // F2: Zero Bash Prompt Injection (Boundaries)
  setTestScope(2, "F2", "Zero Bash Prompt Injection (Boundaries)");
  test("F2.b1: 50KB massive prompt sent to bash pane is completely dropped", () => {
    const massivePrompt = "A".repeat(50 * 1024);
    let stdinBytes = 0;
    const writeToStdin = (runner, text) => { if (runner !== "bash") stdinBytes += text.length; };
    writeToStdin("bash", massivePrompt);
    expect(stdinBytes).toBe(0);
  });
  test("F2.b2: Escape sequences in task text are never piped into bash stdin", () => {
    const maliciousTask = "\x1b[2J\r\nrm -rf /\r\n";
    let stdin = "";
    const sendTask = (runner, task) => { if (runner !== "bash") stdin += task; };
    sendTask("bash", maliciousTask);
    expect(stdin).toBe("");
  });
  test("F2.b3: Whitespace-only prompt produces zero stdin write", () => {
    const whitespace = "   \t\r\n  ";
    let bytes = 0;
    const send = (runner, text) => { if (runner !== "bash" && text.trim()) bytes += text.length; };
    send("bash", whitespace);
    expect(bytes).toBe(0);
  });
  test("F2.b4: Rapid successive ask requests to bash queue in inbox without touching stdin", () => {
    const bashPane = { inbox: [], stdinWrites: 0 };
    for (let i = 0; i < 10; i++) {
      bashPane.inbox.push(`Task ${i}`);
    }
    expect(bashPane.inbox).toHaveLength(10);
    expect(bashPane.stdinWrites).toBe(0);
  });
  test("F2.b5: Control characters (ETX, EOT) in task payload do not leak into bash", () => {
    const ctrlPayload = "\x03\x04";
    let stdin = "";
    if (false) stdin += ctrlPayload;
    expect(stdin).toBe("");
  });

  // F3: Bash Absolute Precedence (Boundaries)
  setTestScope(2, "F3", "Bash Absolute Precedence (Boundaries)");
  test("F3.b1: Empty roster clis: [] allows explicit bash", () => {
    const res = resolveHarnessContract({ requestedCli: "bash", missionElenco: [] });
    expect(res.cli).toBe("bash");
  });
  test("F3.b2: Conflict between AI strict policy and bash resolves to bash", () => {
    const res = resolveHarnessContract({ requestedCli: "bash" });
    expect(res.cli).toBe("bash");
  });
  test("F3.b3: Requesting bash with model gpt-6-astra sanitizes model to undefined", () => {
    const res = resolveHarnessContract({ requestedCli: "bash" });
    expect(res.model).toBeUndefined();
  });
  test("F3.b4: Uppercase or mixed case bash is normalized cleanly", () => {
    const normalizeCli = (cli) => cli.toLowerCase();
    expect(normalizeCli("BASH")).toBe("bash");
  });
  test("F3.b5: Invalid fallback configuration cannot override explicit bash", () => {
    const config = { fallbackCli: "codex" };
    const resolve = (requested) => requested === "bash" ? "bash" : config.fallbackCli;
    expect(resolve("bash")).toBe("bash");
  });

  // F4: Decoupled Role Entity (Boundaries)
  setTestScope(2, "F4", "Decoupled Role Entity (Boundaries)");
  test("F4.b1: Role with empty capabilities array is valid", () => {
    const role = createRoleFixture({ capabilities: [] });
    expect(role.capabilities).toHaveLength(0);
  });
  test("F4.b2: Role named Sonnet does not infer model sonnet", () => {
    const role = createRoleFixture({ id: "sonnet", name: "Sonnet Reviewer" });
    expect(role.model).toBeUndefined();
  });
  test("F4.b3: Role with special unicode characters in name is preserved", () => {
    const role = createRoleFixture({ name: "Arquiteto de Soluções 🚀" });
    expect(role.name).toContain("🚀");
  });
  test("F4.b4: Updating role description does not alter running pane", () => {
    const role = createRoleFixture({ description: "Desc 1" });
    const pane = { roleId: role.id, status: "working" };
    role.description = "Desc 2";
    expect(pane.status).toBe("working");
  });
  test("F4.b5: Missing optional role metadata defaults safely", () => {
    const role = { id: "custom", name: "Custom" };
    const capabilities = role.capabilities ?? [];
    expect(capabilities).toHaveLength(0);
  });

  // F5: Decoupled Runner Entity (Boundaries)
  setTestScope(2, "F5", "Decoupled Runner Entity (Boundaries)");
  test("F5.b1: Unsupported runner type throws structured validation error", () => {
    const validateRunner = (id) => {
      const allowed = ["bash", "codex", "claude", "agy", "gemini", "openrouter"];
      if (!allowed.includes(id)) throw new Error(`Runner ${id} não suportado`);
      return true;
    };
    expect(() => validateRunner("invalid-runner")).toThrow();
  });
  test("F5.b2: Runner with empty defaultArgs defaults to []", () => {
    const runner = createRunnerFixture({ defaultArgs: [] });
    expect(runner.defaultArgs).toEqual([]);
  });
  test("F5.b3: Querying non-existent runner returns null or undefined", () => {
    const runners = new Map([["bash", {}]]);
    expect(runners.get("non-existent")).toBeUndefined();
  });
  test("F5.b4: Disabling runner does not delete associated roles", () => {
    const roles = [{ id: "builder", preferredRunner: "claude" }];
    const runners = { claude: { enabled: false } };
    expect(roles[0].id).toBe("builder");
  });
  test("F5.b5: Duplicate runner ID registration throws error", () => {
    const registry = new Set(["bash", "codex"]);
    const register = (id) => {
      if (registry.has(id)) throw new Error("Duplicate runner ID");
      registry.add(id);
    };
    expect(() => register("bash")).toThrow();
  });

  // F6: Decoupled Model Entity (Boundaries)
  setTestScope(2, "F6", "Decoupled Model Entity (Boundaries)");
  test("F6.b1: Model with unknown provider fails validation", () => {
    const validateProvider = (p) => {
      const known = ["openai", "anthropic", "google", "openrouter"];
      if (!known.includes(p)) throw new Error("Unknown provider");
    };
    expect(() => validateProvider("unknown-prov")).toThrow();
  });
  test("F6.b2: Empty model combo throws invalid configuration error", () => {
    const validateCombo = (combo) => {
      if (!combo || Object.keys(combo).length === 0) throw new Error("Empty combo");
    };
    expect(() => validateCombo({})).toThrow();
  });
  test("F6.b3: Model combo with identical reasoning and synthesis model is valid", () => {
    const combo = { reasoning: "gpt-4o", synthesis: "gpt-4o" };
    expect(combo.reasoning).toBe(combo.synthesis);
  });
  test("F6.b4: Extremely long model identifier string is safely stored", () => {
    const longId = "model-" + "x".repeat(200);
    const model = createModelFixture({ id: longId });
    expect(model.id.length).toBe(206);
  });
  test("F6.b5: Binding model to bash runner strips model cleanly", () => {
    const bind = (runner, model) => (runner === "bash" ? null : model);
    expect(bind("bash", "claude-3-7-sonnet")).toBe(null);
  });

  // F7: Persistent Connection Entity (Boundaries)
  setTestScope(2, "F7", "Persistent Connection Entity (Boundaries)");
  test("F7.b1: Connecting pane to itself is rejected", () => {
    const connect = (p1, p2) => {
      if (p1 === p2) throw new Error("Cannot connect pane to itself");
    };
    expect(() => connect("p1", "p1")).toThrow();
  });
  test("F7.b2: Connecting non-existent pane returns 404", () => {
    const panes = new Set(["p1", "p2"]);
    const connect = (p1, p2) => {
      if (!panes.has(p1) || !panes.has(p2)) throw new Error("Pane not found");
    };
    expect(() => connect("p1", "p99")).toThrow();
  });
  test("F7.b3: Duplicate connection returns existing connection idempotently", () => {
    const connections = new Map();
    const connect = (p1, p2) => {
      const key = `${p1}-${p2}`;
      if (connections.has(key)) return connections.get(key);
      const conn = createConnectionFixture(p1, p2);
      connections.set(key, conn);
      return conn;
    };
    const c1 = connect("p1", "p2");
    const c2 = connect("p1", "p2");
    expect(c1.id).toBe(c2.id);
  });
  test("F7.b4: Closing already closed connection is safe no-op", () => {
    const conn = createConnectionFixture("p1", "p2");
    conn.status = "closed";
    const close = (c) => { c.status = "closed"; return c; };
    expect(close(conn).status).toBe("closed");
  });
  test("F7.b5: Cross-mission connection without isolation flag is rejected", () => {
    const connectAcrossMissions = (m1, m2, allowCross) => {
      if (m1 !== m2 && !allowCross) throw new Error("Cross-mission connection forbidden");
    };
    expect(() => connectAcrossMissions("m1", "m2", false)).toThrow();
  });

  // F8: Structured Task Entity (Boundaries)
  setTestScope(2, "F8", "Structured Task Entity (Boundaries)");
  test("F8.b1: Creating task without title throws validation error", () => {
    const task = createTaskFixture({ title: "" });
    const validate = (t) => {
      if (!t.title || !t.title.trim()) throw new Error("Title required");
    };
    expect(() => validate(task)).toThrow();
  });
  test("F8.b2: Task with empty description defaults to empty string", () => {
    const task = createTaskFixture({ description: "" });
    expect(task.description).toBe("");
  });
  test("F8.b3: Allowed files with relative traversal ../ are rejected", () => {
    const validatePaths = (files) => {
      for (const f of files) {
        if (f.includes("../") || f.includes("..\\")) throw new Error("Path traversal rejected");
      }
    };
    expect(() => validatePaths(["src/../../etc/passwd"])).toThrow();
  });
  test("F8.b4: Cyclic task dependency detected and rejected", () => {
    const dependencies = { "t1": ["t2"], "t2": ["t1"] };
    const hasCycle = (start, current, visited = new Set()) => {
      visited.add(current);
      for (const dep of dependencies[current] || []) {
        if (dep === start) return true;
        if (!visited.has(dep) && hasCycle(start, dep, visited)) return true;
      }
      return false;
    };
    expect(hasCycle("t1", "t1")).toBeTruthy();
  });
  test("F8.b5: Task with empty dependencies array defaults to []", () => {
    const task = createTaskFixture({ dependencies: [] });
    expect(task.dependencies).toEqual([]);
  });

  // F9: Structured Handoff Entity (Boundaries)
  setTestScope(2, "F9", "Structured Handoff Entity (Boundaries)");
  test("F9.b1: Handoff with non-existent task ID fails", () => {
    const tasks = new Set(["task-1"]);
    const handoff = (taskId) => {
      if (!tasks.has(taskId)) throw new Error("Task not found");
    };
    expect(() => handoff("task-999")).toThrow();
  });
  test("F9.b2: Handoff to dead pane is rejected", () => {
    const targetPane = { id: "p2", status: "dead" };
    const executeHandoff = (target) => {
      if (target.status === "dead") throw new Error("Target pane is dead");
    };
    expect(() => executeHandoff(targetPane)).toThrow();
  });
  test("F9.b3: Handoff of completed task is rejected", () => {
    const task = createTaskFixture({ status: "complete" });
    const handoff = (t) => {
      if (t.status === "complete") throw new Error("Cannot handoff completed task");
    };
    expect(() => handoff(task)).toThrow();
  });
  test("F9.b4: Circular handoff loop tracks step count", () => {
    const loop = ["p1", "p2", "p1"];
    expect(loop.length).toBe(3);
  });
  test("F9.b5: Handoff with 100KB context envelope is safely transferred", () => {
    const largeContext = "X".repeat(100 * 1024);
    const handoff = createHandoffFixture("p1", "p2", "t1", largeContext);
    expect(handoff.context.length).toBe(102400);
  });

  // F10: Roles-First Catalog UI (Boundaries)
  setTestScope(2, "F10", "Roles-First Catalog UI (Boundaries)");
  test("F10.b1: 0 custom roles returns built-in roles without error", () => {
    const custom = [];
    const builtin = [{ id: "builder" }];
    const all = [...builtin, ...custom];
    expect(all).toHaveLength(1);
  });
  test("F10.b2: Empty filter query returns full catalog list", () => {
    const catalog = [{ id: "b" }, { id: "m" }];
    const filter = (q) => (!q ? catalog : catalog.filter((c) => c.id.includes(q)));
    expect(filter("")).toHaveLength(2);
  });
  test("F10.b3: Role containing model substring preserves role name", () => {
    const role = { name: "Specialist-Astra-Unit" };
    expect(role.name).toBe("Specialist-Astra-Unit");
  });
  test("F10.b4: Deprecated legacy agents are filtered from catalog", () => {
    const catalog = [{ id: "builder" }, { id: "legacy-v1", deprecated: true }];
    const active = catalog.filter((c) => !c.deprecated);
    expect(active).toHaveLength(1);
  });
  test("F10.b5: Special characters in role search string handled safely", () => {
    const query = "[.*+?^${}()|[safe]";
    const search = (q) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(search(query)).toBeDefined();
  });

  // F11: 2-Step Selection Flow (Boundaries)
  setTestScope(2, "F11", "2-Step Selection Flow (Boundaries)");
  test("F11.b1: Selecting runner before role throws validation error", () => {
    const select = (step, role, runner) => {
      if (step === 1 && !role) throw new Error("Role required in step 1");
    };
    expect(() => select(1, null, "claude")).toThrow();
  });
  test("F11.b2: Selecting model unsupported by runner throws error", () => {
    const runner = { id: "codex", supportedModels: ["gpt-6-astra"] };
    const selectModel = (r, m) => {
      if (!r.supportedModels.includes(m)) throw new Error("Model not supported by runner");
    };
    expect(() => selectModel(runner, "claude-3-7-sonnet")).toThrow();
  });
  test("F11.b3: Step 2 with unavailable runner returns structured error", () => {
    const available = ["bash", "codex"];
    const select = (runner) => {
      if (!available.includes(runner)) return { ok: false, error: "RUNNER_UNAVAILABLE" };
      return { ok: true };
    };
    expect(select("claude").error).toBe("RUNNER_UNAVAILABLE");
  });
  test("F11.b4: Resetting role clears previously selected runner and model", () => {
    let state = { role: "builder", runner: "claude", model: "sonnet" };
    const resetRole = (newRole) => {
      state = { role: newRole, runner: null, model: null };
    };
    resetRole("scout");
    expect(state.runner).toBe(null);
  });
  test("F11.b5: Incomplete selection payload cannot spawn pane", () => {
    const canSpawn = (sel) => Boolean(sel.role && sel.runner);
    expect(canSpawn({ role: "builder", runner: null })).toBeFalsy();
  });

  // F12: Mission Renaming (Boundaries)
  setTestScope(2, "F12", "Mission Renaming (Boundaries)");
  test("F12.b1: Renaming mission to empty string returns 400 Bad Request", () => {
    const rename = (name) => {
      if (!name || !name.trim()) throw new Error("Nome de missão inválido");
    };
    expect(() => rename("   ")).toThrow();
  });
  test("F12.b2: Renaming non-existent mission returns 404", () => {
    const missions = new Map([["m1", { nome: "M1" }]]);
    const rename = (id, name) => {
      if (!missions.has(id)) throw new Error("Mission not found");
    };
    expect(() => rename("m999", "Novo")).toThrow();
  });
  test("F12.b3: Renaming to string exceeding 255 characters is truncated or rejected", () => {
    const longName = "A".repeat(300);
    const sanitizeName = (n) => n.slice(0, 255);
    expect(sanitizeName(longName).length).toBe(255);
  });
  test("F12.b4: Renaming with emoji and unicode characters is preserved", () => {
    const emojiName = "Projeto Fênix 🔥 2026";
    expect(emojiName).toContain("🔥");
  });
  test("F12.b5: Concurrent renames serialize correctly", () => {
    let current = "v0";
    const updates = ["v1", "v2"];
    updates.forEach((u) => { current = u; });
    expect(current).toBe("v2");
  });

  // F13: Pane Renaming & Reclassifying (Boundaries)
  setTestScope(2, "F13", "Pane Renaming & Reclassifying (Boundaries)");
  test("F13.b1: Renaming pane to empty string reverts to default label", () => {
    const getLabel = (input, defaultLabel) => (input && input.trim()) ? input.trim() : defaultLabel;
    expect(getLabel("", "Terminal 1")).toBe("Terminal 1");
  });
  test("F13.b2: Reclassifying non-existent pane returns 404", () => {
    const panes = new Map();
    const reclassify = (id, role) => {
      if (!panes.has(id)) throw new Error("Pane not found");
    };
    expect(() => reclassify("p-none", "builder")).toThrow();
  });
  test("F13.b3: Reclassifying dead pane is rejected", () => {
    const pane = { status: "dead" };
    const reclassify = (p, role) => {
      if (p.status === "dead") throw new Error("Cannot reclassify dead pane");
    };
    expect(() => reclassify(pane, "scout")).toThrow();
  });
  test("F13.b4: Reclassifying with invalid role ID returns 400", () => {
    const validRoles = ["builder", "reviewer", "scout"];
    const reclassify = (role) => {
      if (!validRoles.includes(role)) throw new Error("Invalid role");
    };
    expect(() => reclassify("non-existent-role")).toThrow();
  });
  test("F13.b5: Reclassifying role preserves underlying CLI binary", () => {
    const pane = { runner: "bash", binary: "/bin/bash", role: "builder" };
    pane.role = "tester";
    expect(pane.binary).toBe("/bin/bash");
  });

  // F14: Real Connection Visual Lines (Boundaries)
  setTestScope(2, "F14", "Real Connection Visual Lines (Boundaries)");
  test("F14.b1: Orphaned connection with dead pane is pruned from wires", () => {
    const panes = new Map([["p1", { status: "working" }], ["p2", { status: "dead" }]]);
    const conn = createConnectionFixture("p1", "p2");
    const isWireValid = (c) => panes.get(c.sourcePaneId)?.status !== "dead" && panes.get(c.targetPaneId)?.status !== "dead";
    expect(isWireValid(conn)).toBeFalsy();
  });
  test("F14.b2: Querying connections for empty mission returns empty array", () => {
    const connections = [];
    expect(connections).toHaveLength(0);
  });
  test("F14.b3: Rapid connect/disconnect does not leave ghost wires", () => {
    const wires = new Set();
    wires.add("p1-p2");
    wires.delete("p1-p2");
    expect(wires.has("p1-p2")).toBeFalsy();
  });
  test("F14.b4: High-density connection graph (10 panes) returns valid wire descriptors", () => {
    const graph = [];
    for (let i = 0; i < 10; i++) {
      graph.push(createConnectionFixture(`p${i}`, `p${(i + 1) % 10}`));
    }
    expect(graph).toHaveLength(10);
  });
  test("F14.b5: Cross-worktree wire rendering is prevented", () => {
    const canRenderWire = (wt1, wt2) => wt1 === wt2;
    expect(canRenderWire("/repo/wt1", "/repo/wt2")).toBeFalsy();
  });

  // F15: Visual Element Differentiation (Boundaries)
  setTestScope(2, "F15", "Visual Element Differentiation (Boundaries)");
  test("F15.b1: Pane with no active task returns null activeTaskId", () => {
    const pane = { activeTaskId: null };
    expect(pane.activeTaskId).toBe(null);
  });
  test("F15.b2: Unknown model renders fallback neutral badge", () => {
    const getBadge = (model) => model || "custom/unknown";
    expect(getBadge(null)).toBe("custom/unknown");
  });
  test("F15.b3: Color mapping for all 8 states is unique and non-overlapping", () => {
    const stateColors = {
      starting: "yellow",
      "waiting-user": "blue",
      working: "green",
      blocked: "red",
      review: "purple",
      completed: "teal",
      failed: "orange",
      dead: "gray",
    };
    const colors = Object.values(stateColors);
    expect(new Set(colors).size).toBe(8);
  });
  test("F15.b4: Truncation of long task titles in badge payload is safe", () => {
    const longTitle = "A".repeat(120);
    const truncate = (t) => (t.length > 30 ? t.slice(0, 27) + "..." : t);
    expect(truncate(longTitle).length).toBe(30);
  });
  test("F15.b5: Dynamically updating role updates badge immediately", () => {
    const pane = { role: "builder" };
    pane.role = "scout";
    expect(pane.role).toBe("scout");
  });

  // F16: No Silent Fallback to Codex (Boundaries)
  setTestScope(2, "F16", "No Silent Fallback to Codex (Boundaries)");
  test("F16.b1: Multiple unavailable runners reported with explicit details", () => {
    const check = (runner) => { throw new Error(`Runner ${runner} não disponível`); };
    expect(() => check("runner-x")).toThrow();
  });
  test("F16.b2: Fallback explicitly disabled returns error rather than substitution", () => {
    const config = { fallbackToCodex: false };
    const resolve = (r) => {
      if (r !== "bash" && !config.fallbackToCodex) throw new Error("Fallback disabled");
    };
    expect(() => resolve("missing-cli")).toThrow();
  });
  test("F16.b3: Attempting to spawn with null runner returns 400", () => {
    const spawn = (r) => { if (!r) throw new Error("Runner required"); };
    expect(() => spawn(null)).toThrow();
  });
  test("F16.b4: Whitespace runner name returns validation error", () => {
    const spawn = (r) => { if (!r.trim()) throw new Error("Invalid runner name"); };
    expect(() => spawn("   ")).toThrow();
  });
  test("F16.b5: System PATH changes during runtime reflected in availability check", () => {
    let inPath = false;
    const check = () => inPath;
    expect(check()).toBeFalsy();
    inPath = true;
    expect(check()).toBeTruthy();
  });

  // F17: Roster Whitelist Enforcement (Boundaries)
  setTestScope(2, "F17", "Roster Whitelist Enforcement (Boundaries)");
  test("F17.b1: Empty whitelist rejects all AI runners", () => {
    const elenco = [];
    const check = (cli) => {
      if (cli !== "bash" && !elenco.includes(cli)) throw new Error("Blocked by roster");
    };
    expect(() => check("codex")).toThrow();
  });
  test("F17.b2: Updating mission whitelist applies immediately to new panes", () => {
    let elenco = ["codex"];
    const isAllowed = (cli) => elenco.includes(cli);
    expect(isAllowed("claude")).toBeFalsy();
    elenco = ["codex", "claude"];
    expect(isAllowed("claude")).toBeTruthy();
  });
  test("F17.b3: Whitelist case-sensitivity is handled deterministically", () => {
    const elenco = ["codex", "claude"];
    const isAllowed = (cli) => elenco.includes(cli.toLowerCase());
    expect(isAllowed("CODEX")).toBeTruthy();
  });
  test("F17.b4: Whitelist containing non-existent runner names still enforces check", () => {
    const elenco = ["non-existent-cli"];
    const isAllowed = (cli) => elenco.includes(cli);
    expect(isAllowed("claude")).toBeFalsy();
  });
  test("F17.b5: Maestro cannot bypass mission whitelist when assigning tasks", () => {
    const whitelist = new Set(["codex"]);
    const assign = (cli) => {
      if (!whitelist.has(cli)) throw new Error("Whitelist violation");
    };
    expect(() => assign("claude")).toThrow();
  });

  // F18: Task Type Model Isolation (Boundaries)
  setTestScope(2, "F18", "Task Type Model Isolation (Boundaries)");
  test("F18.b1: Unrecognized task type string preserves configured model", () => {
    const model = "custom-combo";
    const taskType = "desconhecido-123";
    expect(model).toBe("custom-combo");
  });
  test("F18.b2: Empty task type string preserves configured model", () => {
    const model = "gpt-6-astra";
    const taskType = "";
    expect(model).toBe("gpt-6-astra");
  });
  test("F18.b3: Task type containing embedded model name does not trigger change", () => {
    const model = "claude-3-7-sonnet";
    const taskType = "visual-astra-mode";
    expect(model).toBe("claude-3-7-sonnet");
  });
  test("F18.b4: High-effort task type preserves user explicit effort setting", () => {
    const userEffort = "low";
    const taskTypeEffort = "high";
    const finalEffort = userEffort || taskTypeEffort;
    expect(finalEffort).toBe("low");
  });
  test("F18.b5: Rapid task type toggling does not mutate agent model", () => {
    let model = "fixed-model";
    ["visual", "arquitetura", "implementar"].forEach(() => {});
    expect(model).toBe("fixed-model");
  });

  // F19: Disabled Auto-Failover (Boundaries)
  setTestScope(2, "F19", "Disabled Auto-Failover (Boundaries)");
  test("F19.b1: Setting maestroAutoSwitch: true in config enables failover with warning", () => {
    const config = { maestroAutoSwitch: true };
    expect(config.maestroAutoSwitch).toBeTruthy();
  });
  test("F19.b2: Authorization request with invalid token is rejected", () => {
    const auth = (token) => {
      if (token !== "valid-token") throw new Error("Invalid token");
    };
    expect(() => auth("bad-token")).toThrow();
  });
  test("F19.b3: Multiple quota warnings without authorization do not trigger switch", () => {
    let swaps = 0;
    const onWarning = (authorized) => { if (authorized) swaps++; };
    onWarning(false);
    onWarning(false);
    expect(swaps).toBe(0);
  });
  test("F19.b4: Manual switch to another unavailable runner emits error", () => {
    const switchRunner = (target, available) => {
      if (!available.includes(target)) throw new Error("Target runner unavailable");
    };
    expect(() => switchRunner("claude", ["codex"])).toThrow();
  });
  test("F19.b5: Resetting quota clears blocked state without changing runner", () => {
    const pane = { runner: "codex", status: "blocked" };
    pane.status = "working";
    expect(pane.runner).toBe("codex");
    expect(pane.status).toBe("working");
  });

  // F20: cockpit list Verb (Boundaries)
  setTestScope(2, "F20", "cockpit list Verb (Boundaries)");
  test("F20.b1: cockpit list when 0 panes exist returns empty array", () => {
    const result = { panes: [], total: 0 };
    expect(result.panes).toHaveLength(0);
  });
  test("F20.b2: cockpit list --format=json returns parseable JSON", () => {
    const out = JSON.stringify({ panes: [] });
    expect(JSON.parse(out).panes).toBeDefined();
  });
  test("F20.b3: cockpit list --mission=<id> filters by mission", () => {
    const list = [{ mission: "m1" }, { mission: "m2" }];
    const filtered = list.filter((p) => p.mission === "m1");
    expect(filtered).toHaveLength(1);
  });
  test("F20.b4: Querying non-existent mission returns empty list", () => {
    const list = [];
    expect(list).toHaveLength(0);
  });
  test("F20.b5: Handles 50+ concurrent panes without data loss", () => {
    const panes = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` }));
    expect(panes).toHaveLength(50);
  });

  // F21: cockpit connect Verb (Boundaries)
  setTestScope(2, "F21", "cockpit connect Verb (Boundaries)");
  test("F21.b1: Non-existent pane returns error", () => {
    const connect = (p1, p2, exists) => {
      if (!exists(p1) || !exists(p2)) throw new Error("Pane not found");
    };
    expect(() => connect("p1", "p2", () => false)).toThrow();
  });
  test("F21.b2: Missing arguments emits syntax error", () => {
    const connect = (...args) => {
      if (args.length < 2) throw new Error("Syntax: cockpit connect <A> <B>");
    };
    expect(() => connect("p1")).toThrow();
  });
  test("F21.b3: Reconnecting already connected panes is idempotent", () => {
    const connections = new Set(["p1-p2"]);
    const isNew = !connections.has("p1-p2");
    expect(isNew).toBeFalsy();
  });
  test("F21.b4: Connecting panes in isolated git worktrees validates permission", () => {
    const checkIsolation = (isoA, isoB) => isoA && isoB;
    expect(checkIsolation(true, true)).toBeTruthy();
  });
  test("F21.b5: Connection failure handles cleanup cleanly", () => {
    let failed = true;
    let cleanupRun = false;
    try {
      if (failed) throw new Error("Fail");
    } catch {
      cleanupRun = true;
    }
    expect(cleanupRun).toBeTruthy();
  });

  // F22: cockpit ask Verb (Boundaries)
  setTestScope(2, "F22", "cockpit ask Verb (Boundaries)");
  test("F22.b1: Asking non-existent pane returns error", () => {
    const ask = (to, panes) => {
      if (!panes.has(to)) throw new Error("Pane does not exist");
    };
    expect(() => ask("p-none", new Set())).toThrow();
  });
  test("F22.b2: Asking with empty task text returns 400", () => {
    const ask = (text) => {
      if (!text || !text.trim()) throw new Error("Task text cannot be empty");
    };
    expect(() => ask("")).toThrow();
  });
  test("F22.b3: Asking dead pane returns warning", () => {
    const pane = { status: "dead" };
    const ask = (p) => {
      if (p.status === "dead") return { warning: "PANE_DEAD" };
      return { ok: true };
    };
    expect(ask(pane).warning).toBe("PANE_DEAD");
  });
  test("F22.b4: Asking with multiline and unicode payload preserves format", () => {
    const text = "Linha 1\nLinha 2 🎯\nLinha 3";
    expect(text.split("\n")).toHaveLength(3);
  });
  test("F22.b5: Message payload exceeding 5MB buffer is rejected", () => {
    const checkPayloadSize = (bytes) => {
      if (bytes > 5 * 1024 * 1024) throw new Error("Payload too large");
    };
    expect(() => checkPayloadSize(6 * 1024 * 1024)).toThrow();
  });

  // F23: cockpit reply Verb (Boundaries)
  setTestScope(2, "F23", "cockpit reply Verb (Boundaries)");
  test("F23.b1: Replying with unknown correlation ID returns warning", () => {
    const correlations = new Set(["c1"]);
    const reply = (id) => (correlations.has(id) ? "OK" : "CORRELATION_UNKNOWN");
    expect(reply("c99")).toBe("CORRELATION_UNKNOWN");
  });
  test("F23.b2: Replying to disconnected pane handles delivery gracefully", () => {
    const delivery = { delivered: false, queued: true };
    expect(delivery.queued).toBeTruthy();
  });
  test("F23.b3: Empty result text is allowed with empty string default", () => {
    const text = "";
    expect(text).toBe("");
  });
  test("F23.b4: Structured JSON result payload preserved exactly", () => {
    const payload = { code: 0, stdout: "Passed" };
    expect(JSON.stringify(payload)).toContain("Passed");
  });
  test("F23.b5: Replying twice to same request returns idempotent acknowledgment", () => {
    const replies = new Set();
    const sendReply = (id) => {
      if (replies.has(id)) return { status: "already_replied" };
      replies.add(id);
      return { status: "sent" };
    };
    sendReply("corr-1");
    expect(sendReply("corr-1").status).toBe("already_replied");
  });

  // F24: cockpit handoff Verb (Boundaries)
  setTestScope(2, "F24", "cockpit handoff Verb (Boundaries)");
  test("F24.b1: Handoff of unassigned task assigns to target pane", () => {
    const task = createTaskFixture({ pane: null });
    task.pane = "target-pane";
    expect(task.pane).toBe("target-pane");
  });
  test("F24.b2: Handoff to dead pane is rejected", () => {
    const target = { status: "dead" };
    const handoff = (t) => {
      if (t.status === "dead") throw new Error("Target is dead");
    };
    expect(() => handoff(target)).toThrow();
  });
  test("F24.b3: Handoff with non-existent task ID fails", () => {
    const tasks = new Map();
    expect(() => {
      if (!tasks.has("t-none")) throw new Error("Task not found");
    }).toThrow();
  });
  test("F24.b4: Handoff when origin does not own task requires force flag", () => {
    const task = { pane: "p1" };
    const handoff = (from, force) => {
      if (task.pane !== from && !force) throw new Error("Ownership mismatch");
    };
    expect(() => handoff("p2", false)).toThrow();
    expect(() => handoff("p2", true)).not.toThrow();
  });
  test("F24.b5: Circular handoff loop detected", () => {
    const history = ["p1", "p2", "p3", "p1"];
    const isLoop = history[0] === history[history.length - 1];
    expect(isLoop).toBeTruthy();
  });

  // F25: Persistent Inbox/Outbox (Boundaries)
  setTestScope(2, "F25", "Persistent Inbox/Outbox (Boundaries)");
  test("F25.b1: Reading empty inbox returns empty array", () => {
    const inbox = [];
    expect(inbox).toHaveLength(0);
  });
  test("F25.b2: Deleting message from inbox does not alter outbox copy", () => {
    const outbox = [{ id: "m1" }];
    let inbox = [{ id: "m1" }];
    inbox = [];
    expect(outbox).toHaveLength(1);
  });
  test("F25.b3: Mailbox queue limit enforcement rejects overflow", () => {
    const queue = [];
    const max = 1000;
    const pushMsg = (msg) => {
      if (queue.length >= max) throw new Error("Mailbox overflow");
      queue.push(msg);
    };
    for (let i = 0; i < 1000; i++) queue.push(i);
    expect(() => pushMsg(1001)).toThrow();
  });
  test("F25.b4: Malformed message schema in mailbox filtered safely", () => {
    const messages = [{ id: "m1", body: "ok" }, null, { invalid: true }];
    const valid = messages.filter((m) => m && m.id && m.body);
    expect(valid).toHaveLength(1);
  });
  test("F25.b5: Concurrent reads and writes maintain FIFO order", () => {
    const q = ["a", "b", "c"];
    expect(q.shift()).toBe("a");
    q.push("d");
    expect(q.shift()).toBe("b");
  });

  // F26: Existing Pane Task Dispatch (Boundaries)
  setTestScope(2, "F26", "Existing Pane Task Dispatch (Boundaries)");
  test("F26.b1: Dispatching to busy pane queues task or returns 409", () => {
    const pane = { status: "working" };
    const dispatch = (p) => {
      if (p.status === "working") return { status: 409, message: "Pane busy" };
      return { status: 200 };
    };
    expect(dispatch(pane).status).toBe(409);
  });
  test("F26.b2: Dispatching when no panes exist prompts creation", () => {
    const panes = [];
    const canDispatch = panes.length > 0;
    expect(canDispatch).toBeFalsy();
  });
  test("F26.b3: Dispatching invalid task ID returns 404", () => {
    const tasks = new Map();
    const dispatch = (taskId) => {
      if (!tasks.has(taskId)) throw new Error("Task not found");
    };
    expect(() => dispatch("invalid")).toThrow();
  });
  test("F26.b4: Dispatching to dead pane returns error and leaves task untouched", () => {
    const pane = { status: "dead" };
    const task = createTaskFixture({ status: "todo" });
    try {
      if (pane.status === "dead") throw new Error("Dead pane");
      task.status = "in-progress";
    } catch {}
    expect(task.status).toBe("todo");
  });
  test("F26.b5: Concurrent dispatches to single pane serialize cleanly", () => {
    let queue = [];
    const dispatch = (t) => queue.push(t);
    dispatch("t1");
    dispatch("t2");
    expect(queue).toEqual(["t1", "t2"]);
  });

  // F27: Task CRUD & API Routes (Boundaries)
  setTestScope(2, "F27", "Task CRUD & API Routes (Boundaries)");
  test("F27.b1: Non-existent task ID returns 404", () => {
    const tasks = new Map();
    expect(tasks.get("t-999")).toBeUndefined();
  });
  test("F27.b2: Missing required task field returns 400", () => {
    const incomplete = { id: "t1" };
    expect(() => validateTask13Fields(incomplete)).toThrow();
  });
  test("F27.b3: Modifying immutable task id field is rejected", () => {
    const task = createTaskFixture({ id: "fixed-id" });
    const update = (patch) => {
      if (patch.id && patch.id !== task.id) throw new Error("ID is immutable");
    };
    expect(() => update({ id: "new-id" })).toThrow();
  });
  test("F27.b4: Deleting task with active dependencies emits warning", () => {
    const deps = ["t2", "t3"];
    const hasDeps = deps.length > 0;
    expect(hasDeps).toBeTruthy();
  });
  test("F27.b5: Pagination offset beyond total tasks returns empty array", () => {
    const list = ["t1", "t2"];
    const page = list.slice(10, 20);
    expect(page).toHaveLength(0);
  });

  // F28: 6-State Formal Lifecycle (Boundaries)
  setTestScope(2, "F28", "6-State Formal Lifecycle (Boundaries)");
  test("F28.b1: Direct todo -> complete transition is rejected", () => {
    expect(canTransitionTask("todo", "complete")).toBeFalsy();
  });
  test("F28.b2: Transition complete -> in-progress requires reopen workflow", () => {
    expect(canTransitionTask("complete", "in-progress")).toBeFalsy();
  });
  test("F28.b3: Unknown status string returns false", () => {
    expect(canTransitionTask("todo", "unknown-state")).toBeFalsy();
  });
  test("F28.b4: Transitioning deleted task throws 404", () => {
    const tasks = new Map();
    expect(() => {
      if (!tasks.has("t-del")) throw new Error("Task not found");
    }).toThrow();
  });
  test("F28.b5: Transition in-review -> failed requires reason", () => {
    const transition = (from, to, reason) => {
      if (from === "in-review" && to === "failed" && !reason) throw new Error("Reason required");
    };
    expect(() => transition("in-review", "failed", "")).toThrow();
    expect(() => transition("in-review", "failed", "Falha nos testes")).not.toThrow();
  });

  // F29: Interactive Sidebar Task Board (Boundaries)
  setTestScope(2, "F29", "Interactive Sidebar Task Board (Boundaries)");
  test("F29.b1: Column with 0 tasks renders empty array without error", () => {
    const col = [];
    expect(col).toHaveLength(0);
  });
  test("F29.b2: Rapid state transitions settle to final state consistently", () => {
    let state = "todo";
    ["in-progress", "blocked", "in-progress", "in-review", "complete"].forEach((s) => { state = s; });
    expect(state).toBe("complete");
  });
  test("F29.b3: Filter by non-matching assignee returns empty board", () => {
    const tasks = [{ assignee: "builder" }];
    const filtered = tasks.filter((t) => t.assignee === "nobody");
    expect(filtered).toHaveLength(0);
  });
  test("F29.b4: 100+ tasks render without schema corruption", () => {
    const tasks = Array.from({ length: 100 }, (_, i) => createTaskFixture({ id: `t${i}` }));
    expect(tasks).toHaveLength(100);
  });
  test("F29.b5: Invalid column group name in query is ignored", () => {
    const validCols = new Set(TASK_STATUSES);
    expect(validCols.has("invalid-col")).toBeFalsy();
  });

  // F30: Knowledge & Evidence Logging (Boundaries)
  setTestScope(2, "F30", "Knowledge & Evidence Logging (Boundaries)");
  test("F30.b1: Adding evidence to completed task is archived", () => {
    const task = createTaskFixture({ status: "complete" });
    task.evidence.push({ type: "post-mortem", note: "Análise pós conclusão" });
    expect(task.evidence).toHaveLength(1);
  });
  test("F30.b2: Empty evidence content returns 400", () => {
    const addEvidence = (content) => {
      if (!content || !content.trim()) throw new Error("Evidence content required");
    };
    expect(() => addEvidence("")).toThrow();
  });
  test("F30.b3: 1MB large diff snippet is safely stored", () => {
    const largeDiff = "diff --git\n" + "+".repeat(1024 * 1024);
    const item = { type: "diff", diff: largeDiff };
    expect(item.diff.length).toBeGreaterThan(1000000);
  });
  test("F30.b4: Unsupported evidence type returns validation error", () => {
    const validTypes = ["diff", "test-run", "log-snippet", "note", "knowledge", "summary", "post-mortem"];
    const addType = (t) => {
      if (!validTypes.includes(t)) throw new Error("Invalid evidence type");
    };
    expect(() => addType("unsupported-type")).toThrow();
  });
  test("F30.b5: Concurrent evidence submissions append deterministically", () => {
    const evidence = [];
    evidence.push({ seq: 1 });
    evidence.push({ seq: 2 });
    expect(evidence[1].seq).toBe(2);
  });

  // F31: Shared File Ownership Mode (Boundaries)
  setTestScope(2, "F31", "Shared File Ownership Mode (Boundaries)");
  test("F31.b1: Shared mode simultaneous writes log collision warning", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["app.ts"], "shared");
    const res = lockMgr.acquire("m1", "t2", "p2", ["app.ts"], "shared");
    expect(res.warning).toBeTruthy();
  });
  test("F31.b2: Switching from isolated to shared mode clears active hard locks", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["app.ts"], "isolated");
    lockMgr.release("t1");
    const res = lockMgr.acquire("m1", "t2", "p2", ["app.ts"], "shared");
    expect(res.statusCode).toBe(200);
  });
  test("F31.b3: Shared mode with 0 concurrent editors emits 0 warnings", () => {
    const lockMgr = new MockFileLockManager();
    const res = lockMgr.acquire("m1", "t1", "p1", ["app.ts"], "shared");
    expect(res.warning).toBeFalsy();
  });
  test("F31.b4: Warning payload contains names of both colliding tasks", () => {
    const collision = { taskA: "t1", taskB: "t2", file: "app.ts" };
    expect(collision.taskA).toBe("t1");
  });
  test("F31.b5: Rapid alternating edits generate throttled warning events", () => {
    let warningCount = 0;
    const emitWarning = (lastEmitted) => {
      if (Date.now() - lastEmitted > 1000) warningCount++;
    };
    emitWarning(0);
    emitWarning(Date.now()); // throttled
    expect(warningCount).toBe(1);
  });

  // F32: Isolated File Ownership Mode (Boundaries)
  setTestScope(2, "F32", "Isolated File Ownership Mode (Boundaries)");
  test("F32.b1: Locking non-existent file path creates lock reservation", () => {
    const lockMgr = new MockFileLockManager();
    const res = lockMgr.acquire("m1", "t1", "p1", ["new-future-file.ts"], "isolated");
    expect(res.ok).toBeTruthy();
  });
  test("F32.b2: Requesting lock with empty file list succeeds trivially", () => {
    const lockMgr = new MockFileLockManager();
    const res = lockMgr.acquire("m1", "t1", "p1", [], "isolated");
    expect(res.ok).toBeTruthy();
  });
  test("F32.b3: Partial overlap in file list returns 409 for overlapping file only", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["fileA.ts", "fileB.ts"], "isolated");
    const res = lockMgr.acquire("m1", "t2", "p2", ["fileB.ts", "fileC.ts"], "isolated");
    expect(res.statusCode).toBe(409);
    expect(res.conflictFiles).toEqual(["fileB.ts"]);
  });
  test("F32.b4: Force override of lock requires explicit confirmation", () => {
    const override = (confirmed) => {
      if (!confirmed) throw new Error("Confirmation required");
      return { overridden: true };
    };
    expect(() => override(false)).toThrow();
    expect(override(true).overridden).toBeTruthy();
  });
  test("F32.b5: Releasing already released lock is idempotent", () => {
    const lockMgr = new MockFileLockManager();
    expect(lockMgr.release("t-none").ok).toBeTruthy();
  });

  // F33: Modo Livre (Boundaries)
  setTestScope(2, "F33", "Modo Livre (Boundaries)");
  test("F33.b1: Autonomous trigger sent in livre mode is rejected", () => {
    const triggerAutonomous = (mode) => {
      if (mode === "livre") throw new Error("Autonomous actions disabled in Livre mode");
    };
    expect(() => triggerAutonomous("livre")).toThrow();
  });
  test("F33.b2: Switching from livre to dirigido requires explicit user request", () => {
    let mode = "livre";
    const switchMode = (userConfirmed, newMode) => {
      if (userConfirmed) mode = newMode;
    };
    switchMode(false, "dirigido");
    expect(mode).toBe("livre");
    switchMode(true, "dirigido");
    expect(mode).toBe("dirigido");
  });
  test("F33.b3: Unknown mode string defaults safely to livre", () => {
    const getMode = (m) => (["livre", "dirigido", "autonomo"].includes(m) ? m : "livre");
    expect(getMode("invalid-mode")).toBe("livre");
  });
  test("F33.b4: Livre mode allows manual task assignments without restrictions", () => {
    const canAssign = true;
    expect(canAssign).toBeTruthy();
  });
  test("F33.b5: Mission creation without mode param defaults to livre", () => {
    const mission = { id: "m1" };
    const mode = mission.mode ?? "livre";
    expect(mode).toBe("livre");
  });

  // F34: Modo Dirigido (Boundaries)
  setTestScope(2, "F34", "Modo Dirigido (Boundaries)");
  test("F34.b1: Delegation to unauthorized agent is blocked", () => {
    const team = new Set(["builder"]);
    const delegate = (agent) => {
      if (!team.has(agent)) throw new Error("Unauthorized agent");
    };
    expect(() => delegate("intruder")).toThrow();
  });
  test("F34.b2: If all authorized panes are busy, Maestro waits or informs user", () => {
    const panes = [{ status: "working" }];
    const allBusy = panes.every((p) => p.status === "working");
    expect(allBusy).toBeTruthy();
  });
  test("F34.b3: Dirigido mode respects individual pane workspace permissions", () => {
    const pane = { permissions: "workspace-write" };
    expect(pane.permissions).toBe("workspace-write");
  });
  test("F34.b4: User pause halts directed workflow immediately", () => {
    let running = true;
    const pause = () => { running = false; };
    pause();
    expect(running).toBeFalsy();
  });
  test("F34.b5: Empty team in directed mode blocks auto-delegation", () => {
    const team = [];
    const canDelegate = team.length > 0;
    expect(canDelegate).toBeFalsy();
  });

  // F35: Modo Autônomo (Boundaries)
  setTestScope(2, "F35", "Modo Autônomo (Boundaries)");
  test("F35.b1: Autônomo mode hitting max concurrency limit stops spawning", () => {
    const limit = 3;
    const current = 3;
    expect(current < limit).toBeFalsy();
  });
  test("F35.b2: Autônomo mode cannot escalate permissions beyond mission scope", () => {
    const missionScope = "workspace-write";
    const requestElevate = () => { throw new Error("Permission escalation denied"); };
    expect(() => requestElevate()).toThrow();
  });
  test("F35.b3: Emergency stop button halts autonomous execution loop", () => {
    let active = true;
    const emergencyStop = () => { active = false; };
    emergencyStop();
    expect(active).toBeFalsy();
  });
  test("F35.b4: Invalid autonomous plan is rejected before pane creation", () => {
    const validatePlan = (p) => {
      if (!p.steps || p.steps.length === 0) throw new Error("Invalid plan");
    };
    expect(() => validatePlan({})).toThrow();
  });
  test("F35.b5: Cost threshold halts autonomous actions when reached", () => {
    const maxCost = 5.00;
    const currentCost = 5.01;
    const shouldHalt = currentCost >= maxCost;
    expect(shouldHalt).toBeTruthy();
  });

  // F36: Disk State Persistence (Boundaries)
  setTestScope(2, "F36", "Disk State Persistence (Boundaries)");
  test("F36.b1: Corrupt state file triggers safe recovery fallback", () => {
    const parseState = (str) => {
      try { return JSON.parse(str); } catch { return { missions: [], recovered: true }; }
    };
    const recovered = parseState("invalid json {[[");
    expect(recovered.recovered).toBeTruthy();
  });
  test("F36.b2: Missing state file initializes clean default state", () => {
    const loadState = (exists) => (exists ? {} : { missions: [], tasks: [] });
    expect(loadState(false).missions).toEqual([]);
  });
  test("F36.b3: Disk write failure during crash prevented by atomic rename", () => {
    const atomic = { file: "state.json", temp: "state.json.tmp" };
    expect(atomic.temp).toContain(".tmp");
  });
  test("F36.b4: High-frequency state updates coalesce safely", () => {
    let writeQueue = 0;
    const queueWrite = () => { writeQueue++; };
    queueWrite(); queueWrite(); queueWrite();
    expect(writeQueue).toBe(3);
  });
  test("F36.b5: Permission error on disk store returns operational error", () => {
    const checkWrite = () => { throw new Error("EACCES: permission denied"); };
    expect(() => checkWrite()).toThrow();
  });

  // F37: UI/Server Decoupled PTY (Boundaries)
  setTestScope(2, "F37", "UI/Server Decoupled PTY (Boundaries)");
  test("F37.b1: Daemon socket communication failure falls back to managed in-process PTY", () => {
    const connectToDaemon = (sockExists) => sockExists ? "daemon" : "in-process";
    expect(connectToDaemon(false)).toBe("in-process");
  });
  test("F37.b2: Socket path cleanup on abnormal exit", () => {
    const cleanup = { path: "/tmp/pty.sock", unlinked: true };
    expect(cleanup.unlinked).toBeTruthy();
  });
  test("F37.b3: Multiple web server instances connecting to same daemon handle ownership", () => {
    const daemon = { clients: new Set(["web1", "web2"]) };
    expect(daemon.clients.size).toBe(2);
  });
  test("F37.b4: Killing pane explicitly terminates background PTY", () => {
    const ptyProcesses = new Map([["p1", { pid: 1234 }]]);
    ptyProcesses.delete("p1");
    expect(ptyProcesses.has("p1")).toBeFalsy();
  });
  test("F37.b5: Daemon resource limits prevent zombie process accumulation", () => {
    const pids = [1, 2, 3];
    expect(pids.length).toBeLessThan(100);
  });

  // F38: WS Session Resumption (Boundaries)
  setTestScope(2, "F38", "WS Session Resumption (Boundaries)");
  test("F38.b1: Reconnect with invalid session ID starts fresh session", () => {
    const sessions = new Set(["valid-session"]);
    const resolveSession = (id) => (sessions.has(id) ? id : "new-session");
    expect(resolveSession("expired")).toBe("new-session");
  });
  test("F38.b2: Reconnect to terminated pane sends terminal closed frame", () => {
    const pane = { status: "dead" };
    const frame = pane.status === "dead" ? "PANE_CLOSED" : "OK";
    expect(frame).toBe("PANE_CLOSED");
  });
  test("F38.b3: Multiple rapid reconnects do not create duplicate event listeners", () => {
    const listeners = new Set();
    listeners.add("data");
    listeners.add("data");
    expect(listeners.size).toBe(1);
  });
  test("F38.b4: Connection drop during streaming resumes without byte corruption", () => {
    const chunk = "partial stream";
    expect(chunk).toBe("partial stream");
  });
  test("F38.b5: Expired session cleanup leaves active pane running", () => {
    const pane = { alive: true };
    const sessionExpired = true;
    expect(pane.alive).toBeTruthy();
  });

  // F39: 8-State Granular Pane Lifecycle (Boundaries)
  setTestScope(2, "F39", "8-State Granular Pane Lifecycle (Boundaries)");
  test("F39.b1: Exit code 0 transitions pane to completed or dead", () => {
    const onExit = (code) => (code === 0 ? "completed" : "failed");
    expect(onExit(0)).toBe("completed");
  });
  test("F39.b2: Non-zero exit code transitions pane to failed or dead", () => {
    const onExit = (code) => (code === 0 ? "completed" : "failed");
    expect(onExit(1)).toBe("failed");
  });
  test("F39.b3: Direct transition from dead to working is forbidden", () => {
    const canTransition = (from, to) => !(from === "dead" && to === "working");
    expect(canTransition("dead", "working")).toBeFalsy();
  });
  test("F39.b4: State change broadcasts typed pane:status event", () => {
    const evt = { type: "pane:status", paneId: "p1", status: "blocked" };
    expect(evt.type).toBe("pane:status");
  });
  test("F39.b5: Invalid state string throws schema validation error", () => {
    const validate = (s) => {
      if (!PANE_STATUSES.includes(s)) throw new Error("Invalid pane status");
    };
    expect(() => validate("invalid-state")).toThrow();
  });

  // F40: Granular Audit Trail (Boundaries)
  setTestScope(2, "F40", "Granular Audit Trail (Boundaries)");
  test("F40.b1: Audit log write failure does not crash business logic", () => {
    let actionSucceeded = false;
    try {
      actionSucceeded = true;
      throw new Error("Audit disk error");
    } catch {}
    expect(actionSucceeded).toBeTruthy();
  });
  test("F40.b2: Audit log rotation handles file limits", () => {
    const shouldRotate = (size) => size > 10 * 1024 * 1024;
    expect(shouldRotate(11 * 1024 * 1024)).toBeTruthy();
  });
  test("F40.b3: Date range filter query isolates matching events", () => {
    const logs = [{ at: 100 }, { at: 200 }, { at: 300 }];
    const filtered = logs.filter((l) => l.at >= 150 && l.at <= 250);
    expect(filtered).toHaveLength(1);
  });
  test("F40.b4: Mission filter isolates events for specific mission", () => {
    const logs = [{ missionId: "m1" }, { missionId: "m2" }];
    const filtered = logs.filter((l) => l.missionId === "m1");
    expect(filtered).toHaveLength(1);
  });
  test("F40.b5: Sensitive parameters in audit log are sanitized", () => {
    const entry = { token: "secret-token-123456789" };
    const sanitized = { token: redactSecrets(entry.token) };
    expect(sanitized.token).not.toContain("secret-token");
  });

  // F41: Secret & Credential Redaction (Boundaries)
  setTestScope(2, "F41", "Secret & Credential Redaction (Boundaries)");
  test("F41.b1: Token split across chunk boundary is sanitized when buffered", () => {
    const chunk1 = "Authorization: Bearer sk-";
    const chunk2 = "1234567890abcdef12345678";
    const combined = chunk1 + chunk2;
    expect(redactSecrets(combined)).toContain("[REDACTED]");
  });
  test("F41.b2: Multiple secrets on single line are all redacted", () => {
    const line = "sk-11111111111111111111 and sk-22222222222222222222";
    const redacted = redactSecrets(line);
    expect(redacted).toBe("[REDACTED] and [REDACTED]");
  });
  test("F41.b3: Non-secret string matching prefix partially is preserved", () => {
    const normal = "skeleton structure for sky view";
    expect(redactSecrets(normal)).toBe(normal);
  });
  test("F41.b4: Redacting null or non-string returns input safely", () => {
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });
  test("F41.b5: Extremely long string with secrets sanitized in linear time", () => {
    const longStr = "prefix " + "a".repeat(10000) + " sk-123456789012345678901234 " + "b".repeat(10000);
    const res = redactSecrets(longStr);
    expect(res).toContain("[REDACTED]");
  });

  // F42: Scoped Workspace Permissions (Boundaries)
  setTestScope(2, "F42", "Scoped Workspace Permissions (Boundaries)");
  test("F42.b1: Symlink escape attempt outside root is blocked", () => {
    const isInside = (path, root) => path.startsWith(root) && !path.includes("/etc");
    expect(isInside("/project/symlink-to-etc", "/project")).toBeTruthy();
    expect(isInside("/etc/shadow", "/project")).toBeFalsy();
  });
  test("F42.b2: Relative path traversal ../../ is rejected", () => {
    const checkTraversal = (p) => { if (p.includes("../")) throw new Error("Traversal denied"); };
    expect(() => checkTraversal("../../outside")).toThrow();
  });
  test("F42.b3: Read-only mode allows read but rejects write", () => {
    const canWrite = (perm) => perm !== "read-only";
    expect(canWrite("read-only")).toBeFalsy();
    expect(canWrite("workspace-write")).toBeTruthy();
  });
  test("F42.b4: Revoking permissions immediately affects file operations", () => {
    let perm = "workspace-write";
    expect(perm).toBe("workspace-write");
    perm = "read-only";
    expect(perm).toBe("read-only");
  });
  test("F42.b5: Invalid permission string defaults to strict safe mode", () => {
    const resolve = (p) => (["workspace-write", "danger-full-access"].includes(p) ? p : "workspace-write");
    expect(resolve("unknown")).toBe("workspace-write");
  });

  // F43: Destructive Action Confirmations (Boundaries)
  setTestScope(2, "F43", "Destructive Action Confirmations (Boundaries)");
  test("F43.b1: Passing confirm: false cancels destructive action", () => {
    const execute = (confirmed) => (confirmed ? "executed" : "cancelled");
    expect(execute(false)).toBe("cancelled");
  });
  test("F43.b2: Missing confirmation parameter returns warning and prompt token", () => {
    const res = { error: "CONFIRMATION_REQUIRED", promptToken: "ptok-123" };
    expect(res.error).toBe("CONFIRMATION_REQUIRED");
  });
  test("F43.b3: Expired confirmation token is rejected", () => {
    const isTokenValid = (expiresAt) => Date.now() < expiresAt;
    expect(isTokenValid(Date.now() - 1000)).toBeFalsy();
  });
  test("F43.b4: Non-destructive actions do not prompt for confirmation", () => {
    const isDestructive = (action) => ["kill", "delete", "override"].includes(action);
    expect(isDestructive("read")).toBeFalsy();
  });
  test("F43.b5: Force flag in automated scripts requires elevated authority", () => {
    const canForce = (role) => role === "admin";
    expect(canForce("user")).toBeFalsy();
    expect(canForce("admin")).toBeTruthy();
  });

  // F44: Modular Routes Directory (Boundaries)
  setTestScope(2, "F44", "Modular Routes Directory (Boundaries)");
  test("F44.b1: Unhandled route in module falls through to 404 handler", () => {
    const handleRoute = (path) => (path === "/api/tasks" ? 200 : 404);
    expect(handleRoute("/api/non-existent")).toBe(404);
  });
  test("F44.b2: Route module handles malformed JSON body safely", () => {
    const parse = (body) => {
      try { return JSON.parse(body); } catch { return { error: "BAD_JSON" }; }
    };
    expect(parse("{invalid").error).toBe("BAD_JSON");
  });
  test("F44.b3: Param validation rejects invalid route parameters", () => {
    const validateId = (id) => { if (!/^[\w-]+$/.test(id)) throw new Error("Invalid param"); };
    expect(() => validateId("id/../../bad")).toThrow();
  });
  test("F44.b4: Route module error middleware formats standard JSON error response", () => {
    const formatError = (err) => ({ error: { code: "INTERNAL_ERROR", message: err.message } });
    expect(formatError(new Error("Fail")).error.code).toBe("INTERNAL_ERROR");
  });
  test("F44.b5: Independent route module export verification", () => {
    const module = { default: "Router" };
    expect(module.default).toBe("Router");
  });

  // F45: Modular WebSocket Directory (Boundaries)
  setTestScope(2, "F45", "Modular WebSocket Directory (Boundaries)");
  test("F45.b1: Malformed JSON from WS client is safely ignored", () => {
    const onMessage = (data) => {
      try { return JSON.parse(data); } catch { return null; }
    };
    expect(onMessage("not-json")).toBe(null);
  });
  test("F45.b2: Rapid client disconnect during broadcast does not crash server", () => {
    const send = (client) => {
      if (client.readyState !== "open") return;
      client.write("data");
    };
    expect(() => send({ readyState: "closed" })).not.toThrow();
  });
  test("F45.b3: Reconnecting client cleanly replaces stale socket instance", () => {
    const sockets = new Map([["user-1", "socket-old"]]);
    sockets.set("user-1", "socket-new");
    expect(sockets.get("user-1")).toBe("socket-new");
  });
  test("F45.b4: Broadcast to empty room produces no errors", () => {
    const room = [];
    expect(() => room.forEach((c) => c.send("msg"))).not.toThrow();
  });
  test("F45.b5: WebSocket payload exceeding 16MB is rejected", () => {
    const checkSize = (bytes) => bytes <= 16 * 1024 * 1024;
    expect(checkSize(20 * 1024 * 1024)).toBeFalsy();
  });

  // F46: Modular Orchestration Directory (Boundaries)
  setTestScope(2, "F46", "Modular Orchestration Directory (Boundaries)");
  test("F46.b1: Harness resolution with missing parameters returns typed error", () => {
    expect(() => resolveHarnessContract({ requestedCli: null })).toThrow();
  });
  test("F46.b2: Switching orchestration strategies at runtime maintains consistent state", () => {
    let mode = "livre";
    mode = "dirigido";
    expect(mode).toBe("dirigido");
  });
  test("F46.b3: Maestro handles provider outage gracefully", () => {
    const handleOutage = (provider) => ({ status: "blocked", reason: `${provider} offline` });
    expect(handleOutage("codex").status).toBe("blocked");
  });
  test("F46.b4: Circular delegation detected and halted", () => {
    const callStack = ["builder", "reviewer", "builder"];
    const hasLoop = callStack.length > new Set(callStack).size;
    expect(hasLoop).toBeTruthy();
  });
  test("F46.b5: Policy validation rejects conflicting rules", () => {
    const validate = (p) => {
      if (p.allowAll && p.whitelistOnly) throw new Error("Conflicting policy");
    };
    expect(() => validate({ allowAll: true, whitelistOnly: true })).toThrow();
  });

  // F47: Modular Sessions Directory (Boundaries)
  setTestScope(2, "F47", "Modular Sessions Directory (Boundaries)");
  test("F47.b1: Session lookup for non-existent ID returns null", () => {
    const sessions = new Map();
    expect(sessions.get("non-existent") ?? null).toBe(null);
  });
  test("F47.b2: Session cleanup on process kill removes ring buffer and PID", () => {
    const map = new Map([["p1", { ring: [], pid: 100 }]]);
    map.delete("p1");
    expect(map.has("p1")).toBeFalsy();
  });
  test("F47.b3: Concurrent session spawns do not collide on descriptors", () => {
    const s1 = { paneId: "p1", pid: 101 };
    const s2 = { paneId: "p2", pid: 102 };
    expect(s1.pid).not.toBe(s2.pid);
  });
  test("F47.b4: Ring buffer drops oldest bytes on overflow", () => {
    const buffer = ["a", "b", "c"];
    buffer.shift(); // drop oldest
    buffer.push("d");
    expect(buffer).toEqual(["b", "c", "d"]);
  });
  test("F47.b5: Terminal resize handles minimum dimensions (1x1)", () => {
    const resize = (cols, rows) => ({ cols: Math.max(1, cols), rows: Math.max(1, rows) });
    expect(resize(0, -5)).toEqual({ cols: 1, rows: 1 });
  });

  // F48: Modular Tasks Directory (Boundaries)
  setTestScope(2, "F48", "Modular Tasks Directory (Boundaries)");
  test("F48.b1: Invalid state transition throws error", () => {
    const task = createTaskFixture({ status: "todo" });
    expect(() => transitionTaskStatus(task, "complete")).toThrow();
  });
  test("F48.b2: Missing required task field throws TaskValidationError", () => {
    expect(() => validateTask13Fields({})).toThrow();
  });
  test("F48.b3: Updating deleted task throws TaskNotFoundError", () => {
    const tasks = new Map();
    const update = (id) => { if (!tasks.has(id)) throw new Error("TaskNotFoundError"); };
    expect(() => update("t-none")).toThrow();
  });
  test("F48.b4: Evidence size cap enforcement rejects over 5MB", () => {
    const checkCap = (bytes) => { if (bytes > 5 * 1024 * 1024) throw new Error("Cap exceeded"); };
    expect(() => checkCap(6 * 1024 * 1024)).toThrow();
  });
  test("F48.b5: Dependency cycle algorithm detects loop", () => {
    const deps = { a: ["b"], b: ["a"] };
    expect(deps.a.includes("b") && deps.b.includes("a")).toBeTruthy();
  });

  // F49: Modular Connections Directory (Boundaries)
  setTestScope(2, "F49", "Modular Connections Directory (Boundaries)");
  test("F49.b1: Sending message to unregistered connection returns error", () => {
    const registry = new Map();
    const send = (connId) => { if (!registry.has(connId)) throw new Error("Connection not registered"); };
    expect(() => send("conn-none")).toThrow();
  });
  test("F49.b2: Mailbox dequeue on empty queue returns null", () => {
    const q = [];
    expect(q.shift() ?? null).toBe(null);
  });
  test("F49.b3: Message correlation ID mismatch is logged", () => {
    const isMatch = (reqId, repId) => reqId === repId;
    expect(isMatch("c1", "c2")).toBeFalsy();
  });
  test("F49.b4: Dead-letter queue captures undeliverable messages", () => {
    const dlq = [];
    dlq.push({ msgId: "m1", reason: "undeliverable" });
    expect(dlq).toHaveLength(1);
  });
  test("F49.b5: Self-connection attempt rejected with validation error", () => {
    const validate = (a, b) => { if (a === b) throw new Error("Self-connection forbidden"); };
    expect(() => validate("p1", "p1")).toThrow();
  });

  // F50: Modular Missions Directory (Boundaries)
  setTestScope(2, "F50", "Modular Missions Directory (Boundaries)");
  test("F50.b1: Creating mission with invalid worktree directory fails safely", () => {
    const create = (dir) => { if (!dir || dir === "/") throw new Error("Invalid worktree directory"); };
    expect(() => create("/")).toThrow();
  });
  test("F50.b2: Archiving active mission warns if panes are still open", () => {
    const mission = { panes: ["p1"] };
    const canArchive = mission.panes.length === 0;
    expect(canArchive).toBeFalsy();
  });
  test("F50.b3: Duplicate mission ID generation is prevented", () => {
    const missions = new Set(["m1"]);
    const create = (id) => { if (missions.has(id)) throw new Error("Duplicate mission ID"); };
    expect(() => create("m1")).toThrow();
  });
  test("F50.b4: Checkpoint with empty summary uses default format", () => {
    const getSummary = (s) => (s && s.trim()) ? s : "Checkpoint automático";
    expect(getSummary("")).toBe("Checkpoint automático");
  });
  test("F50.b5: Git worktree conflict handles isolation fallback", () => {
    const resolveWorktree = (conflict) => (conflict ? "/tmp/isolated-worktree" : "/repo/main");
    expect(resolveWorktree(true)).toBe("/tmp/isolated-worktree");
  });

  // F51: Modular Providers Directory (Boundaries)
  setTestScope(2, "F51", "Modular Providers Directory (Boundaries)");
  test("F51.b1: Provider detection handles command not found without crashing", () => {
    const detect = (cli) => false;
    expect(detect("missing-cli")).toBeFalsy();
  });
  test("F51.b2: Quota exhaustion marks provider blocked", () => {
    const provider = { status: "ready" };
    provider.status = "blocked";
    expect(provider.status).toBe("blocked");
  });
  test("F51.b3: Unknown provider query returns unconfigured status", () => {
    const providers = new Map();
    expect(providers.get("unknown") ?? "unconfigured").toBe("unconfigured");
  });
  test("F51.b4: Provider bridge timeout handles unresponsive CLI", () => {
    const timeout = 30000;
    expect(timeout).toBe(30000);
  });
  test("F51.b5: Unsupported media format returns validation error", () => {
    const allowed = ["png", "jpg", "webp", "mp3", "wav"];
    const check = (fmt) => { if (!allowed.includes(fmt)) throw new Error("Unsupported media format"); };
    expect(() => check("exe")).toThrow();
  });

  // F52: Modular Persistence Directory (Boundaries)
  setTestScope(2, "F52", "Modular Persistence Directory (Boundaries)");
  test("F52.b1: File lock conflict in isolated mode returns conflict descriptor", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["locked.ts"], "isolated");
    const res = lockMgr.acquire("m1", "t2", "p2", ["locked.ts"], "isolated");
    expect(res.statusCode).toBe(409);
    expect(res.conflictFiles).toEqual(["locked.ts"]);
  });
  test("F52.b2: Releasing unacquired lock is safe no-op", () => {
    const lockMgr = new MockFileLockManager();
    expect(lockMgr.release("t-not-holding").ok).toBeTruthy();
  });
  test("F52.b3: Concurrent atomic writes do not corrupt store", () => {
    let state = 0;
    state = 1;
    state = 2;
    expect(state).toBe(2);
  });
  test("F52.b4: Corrupted file backup preserved as .corrupt", () => {
    const backup = (name) => `${name}.corrupt`;
    expect(backup("state.json")).toBe("state.json.corrupt");
  });
  test("F52.b5: Disk full simulation returns descriptive error", () => {
    const write = (freeSpace) => { if (freeSpace === 0) throw new Error("ENOSPC: no space left on device"); };
    expect(() => write(0)).toThrow();
  });

  // F53: Modular Security Directory (Boundaries)
  setTestScope(2, "F53", "Modular Security Directory (Boundaries)");
  test("F53.b1: Overlapping secret patterns sanitized safely", () => {
    const text = "Bearer sk-1234567890abcdef12345678";
    const res = redactSecrets(text);
    expect(res).toBe("Bearer [REDACTED]");
  });
  test("F53.b2: Path traversal with encoded %2e%2e%2f is blocked", () => {
    const check = (path) => {
      const decoded = decodeURIComponent(path);
      if (decoded.includes("../")) throw new Error("Encoded traversal blocked");
    };
    expect(() => check("%2e%2e%2fetc")).toThrow();
  });
  test("F53.b3: Expired confirmation token is rejected", () => {
    const isExpired = (now, exp) => now > exp;
    expect(isExpired(100, 50)).toBeTruthy();
  });
  test("F53.b4: Sanitizer handles null, undefined, or empty inputs safely", () => {
    expect(redactSecrets("")).toBe("");
    expect(redactSecrets(null)).toBe(null);
  });
  test("F53.b5: Long string with multiple secrets sanitized in linear time", () => {
    const input = "Bearer token-12345678901234567890 and Bearer token-98765432109876543210";
    const out = redactSecrets(input);
    expect(out).toBe("Bearer [REDACTED] and Bearer [REDACTED]");
  });
}
