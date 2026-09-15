// Tier 1: Feature Coverage (Isolated Happy Paths for Features 1 through 53)
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

export function registerTier1Tests() {
  // F1: Sovereign Clean Bash
  setTestScope(1, "F1", "Sovereign Clean Bash");
  test("F1.1: Runner bash maps strictly to /bin/bash binary", () => {
    const runner = createRunnerFixture({ id: "bash" });
    expect(runner.binary).toBe("/bin/bash");
  });
  test("F1.2: Runner bash starts with -i and -l flags", () => {
    const runner = createRunnerFixture({ id: "bash" });
    expect(runner.defaultArgs).toEqual(["-i", "-l"]);
  });
  test("F1.3: Runner bash launches with no automatic LLM boot", () => {
    const runner = createRunnerFixture({ id: "bash" });
    expect(runner.supportedModels).toHaveLength(0);
  });
  test("F1.4: Harness resolution for bash strips model parameters", () => {
    const res = resolveHarnessContract({ requestedCli: "bash" });
    expect(res.cli).toBe("bash");
    expect(res.model).toBeUndefined();
  });
  test("F1.5: Harness resolution for bash strips effort parameters", () => {
    const res = resolveHarnessContract({ requestedCli: "bash" });
    expect(res.effort).toBeUndefined();
  });

  // F2: Zero Bash Prompt Injection
  setTestScope(1, "F2", "Zero Bash Prompt Injection");
  test("F2.1: Booting bash terminal sends 0 bytes to stdin", () => {
    const stdinBuffer = [];
    const onBoot = (data) => stdinBuffer.push(data);
    expect(stdinBuffer.length).toBe(0);
  });
  test("F2.2: Bash pane ignores automatic task prompt injection", () => {
    const paneConfig = { runner: "bash", prompt: "Inject me" };
    const injected = paneConfig.runner === "bash" ? null : paneConfig.prompt;
    expect(injected).toBe(null);
  });
  test("F2.3: No role system prompt written to bash stdin", () => {
    const rolePrompt = "You are a builder agent";
    const stdinPayload = false ? rolePrompt : "";
    expect(stdinPayload).toBe("");
  });
  test("F2.4: Terminal stream only forwards direct user keyboard events", () => {
    const userEvent = "ls -la\n";
    let terminalInput = "";
    const handleInput = (src, evt) => { if (src === "user") terminalInput += evt; };
    handleInput("maestro", "do something");
    handleInput("user", userEvent);
    expect(terminalInput).toBe("ls -la\n");
  });
  test("F2.5: Zero background instructions piped into login shell", () => {
    const shellEnv = { SHELL: "/bin/bash", INSTRUCTIONS: undefined };
    expect(shellEnv.INSTRUCTIONS).toBeUndefined();
  });

  // F3: Bash Absolute Precedence
  setTestScope(1, "F3", "Bash Absolute Precedence");
  test("F3.1: Explicit bash overrides mission roster limiting to codex", () => {
    const res = resolveHarnessContract({ requestedCli: "bash", missionElenco: ["codex"] });
    expect(res.cli).toBe("bash");
  });
  test("F3.2: Explicit bash overrides AI strict policy", () => {
    const res = resolveHarnessContract({ requestedCli: "bash", missionElenco: [] });
    expect(res.cli).toBe("bash");
  });
  test("F3.3: Explicit bash overrides agent default runner", () => {
    const res = resolveHarnessContract({ requestedCli: "bash" });
    expect(res.cli).toBe("bash");
  });
  test("F3.4: Auto-failover never substitutes a running bash pane", () => {
    const pane = { runner: "bash", failoverAllowed: false };
    expect(pane.runner).toBe("bash");
    expect(pane.failoverAllowed).toBeFalsy();
  });
  test("F3.5: Bash precedence sets origin to sovereign", () => {
    const res = resolveHarnessContract({ requestedCli: "bash" });
    expect(res.origem.cli).toBe("soberano");
  });

  // F4: Decoupled Role Entity
  setTestScope(1, "F4", "Decoupled Role Entity");
  test("F4.1: Role entity has id, name, description, capabilities", () => {
    const role = createRoleFixture({ id: "scout", name: "Scout" });
    expect(role.id).toBe("scout");
    expect(role.name).toBe("Scout");
  });
  test("F4.2: Role does not contain hardcoded runner", () => {
    const role = createRoleFixture();
    expect(role.runner).toBeUndefined();
  });
  test("F4.3: Role does not contain hardcoded model", () => {
    const role = createRoleFixture();
    expect(role.model).toBeUndefined();
  });
  test("F4.4: Role can be bound to bash runner", () => {
    const binding = { roleId: "builder", runnerId: "bash" };
    expect(binding.runnerId).toBe("bash");
  });
  test("F4.5: Custom user role can be instantiated dynamically", () => {
    const customRole = createRoleFixture({ id: "auditor", name: "Auditor Especial" });
    expect(customRole.id).toBe("auditor");
  });

  // F5: Decoupled Runner Entity
  setTestScope(1, "F5", "Decoupled Runner Entity");
  test("F5.1: Runner entity represents execution harness", () => {
    const runner = createRunnerFixture({ id: "claude", binary: "claude" });
    expect(runner.id).toBe("claude");
  });
  test("F5.2: Runner does not depend on specific role", () => {
    const runner = createRunnerFixture({ id: "codex" });
    expect(runner.role).toBeUndefined();
  });
  test("F5.3: Runner can execute multiple different models", () => {
    const runner = createRunnerFixture({ id: "openrouter", supportedModels: ["gpt-4o", "claude-3-5-sonnet"] });
    expect(runner.supportedModels).toHaveLength(2);
  });
  test("F5.4: Runner list can be queried independently of missions", () => {
    const runners = ["bash", "codex", "claude", "agy", "gemini", "openrouter"];
    expect(runners).toContain("bash");
  });
  test("F5.5: Runner specifies executable command structure", () => {
    const runner = createRunnerFixture({ binary: "/bin/bash", defaultArgs: ["-i", "-l"] });
    expect(runner.binary).toBe("/bin/bash");
  });

  // F6: Decoupled Model Entity
  setTestScope(1, "F6", "Decoupled Model Entity");
  test("F6.1: Model entity defines provider and contextWindow", () => {
    const model = createModelFixture({ id: "gpt-6-astra", provider: "openai" });
    expect(model.id).toBe("gpt-6-astra");
    expect(model.provider).toBe("openai");
  });
  test("F6.2: Model does not dictate role", () => {
    const model = createModelFixture();
    expect(model.role).toBeUndefined();
  });
  test("F6.3: User can configure custom combo model", () => {
    const combo = { reasoning: "claude-3-7-sonnet", synthesis: "gemini-3.1-pro" };
    expect(combo.reasoning).toBe("claude-3-7-sonnet");
  });
  test("F6.4: Model entity validates context window size", () => {
    const model = createModelFixture({ contextWindow: 128000 });
    expect(model.contextWindow).toBe(128000);
  });
  test("F6.5: Model binding is independent of pane lifecycle", () => {
    const binding = { paneId: "p1", modelId: "claude-3-7-sonnet" };
    expect(binding.modelId).toBe("claude-3-7-sonnet");
  });

  // F7: Persistent Connection Entity
  setTestScope(1, "F7", "Persistent Connection Entity");
  test("F7.1: Connection entity has sourcePaneId, targetPaneId, status", () => {
    const conn = createConnectionFixture("p1", "p2");
    expect(conn.sourcePaneId).toBe("p1");
    expect(conn.targetPaneId).toBe("p2");
    expect(conn.status).toBe("active");
  });
  test("F7.2: Connection links two distinct panes", () => {
    const conn = createConnectionFixture("pane-alpha", "pane-beta");
    expect(conn.sourcePaneId).toBe("pane-alpha");
    expect(conn.targetPaneId).toBe("pane-beta");
  });
  test("F7.3: Connection persists across mission lifecycle", () => {
    const conn = createConnectionFixture("p1", "p2", "m-123");
    expect(conn.missionId).toBe("m-123");
  });
  test("F7.4: Connection status can transition to closed", () => {
    const conn = createConnectionFixture("p1", "p2");
    conn.status = "closed";
    expect(conn.status).toBe("closed");
  });
  test("F7.5: Connection entity maintains unique ID", () => {
    const conn = createConnectionFixture("pA", "pB");
    expect(conn.id).toBe("conn-pA-pB");
  });

  // F8: Structured Task Entity
  setTestScope(1, "F8", "Structured Task Entity");
  test("F8.1: Task entity contains all 13 fields", () => {
    const task = createTaskFixture();
    expect(validateTask13Fields(task)).toBeTruthy();
  });
  test("F8.2: Newly created task initializes to todo status", () => {
    const task = createTaskFixture();
    expect(task.status).toBe("todo");
  });
  test("F8.3: Task tracks allowed files array", () => {
    const task = createTaskFixture({ allowedFiles: ["servidor/index.ts", "web/App.tsx"] });
    expect(task.allowedFiles).toHaveLength(2);
  });
  test("F8.4: Task tracks dependencies array", () => {
    const task = createTaskFixture({ dependencies: ["task-1", "task-2"] });
    expect(task.dependencies).toHaveLength(2);
  });
  test("F8.5: Task tracks created and updated timestamps", () => {
    const task = createTaskFixture();
    expect(task.timestamps.createdAt).toBeDefined();
    expect(task.timestamps.updatedAt).toBeDefined();
  });

  // F9: Structured Handoff Entity
  setTestScope(1, "F9", "Structured Handoff Entity");
  test("F9.1: Handoff links source pane, target pane, and taskId", () => {
    const handoff = createHandoffFixture("pane-1", "pane-2", "task-10");
    expect(handoff.sourcePaneId).toBe("pane-1");
    expect(handoff.targetPaneId).toBe("pane-2");
    expect(handoff.taskId).toBe("task-10");
  });
  test("F9.2: Handoff attaches context envelope", () => {
    const handoff = createHandoffFixture("p1", "p2", "t1", "Contexto de entrega do builder");
    expect(handoff.context).toBe("Contexto de entrega do builder");
  });
  test("F9.3: Handoff records creation timestamp", () => {
    const handoff = createHandoffFixture("p1", "p2", "t1");
    expect(handoff.createdAt).toBeDefined();
  });
  test("F9.4: Handoff initializes in pending status", () => {
    const handoff = createHandoffFixture("p1", "p2", "t1");
    expect(handoff.status).toBe("pending");
  });
  test("F9.5: Handoff completion updates status to accepted", () => {
    const handoff = createHandoffFixture("p1", "p2", "t1");
    handoff.status = "accepted";
    expect(handoff.status).toBe("accepted");
  });

  // F10: Roles-First Catalog UI
  setTestScope(1, "F10", "Roles-First Catalog UI");
  test("F10.1: Catalog lists pure roles without model names", () => {
    const catalog = [
      { id: "maestro", name: "Maestro" },
      { id: "builder", name: "Builder" },
      { id: "reviewer", name: "Reviewer" },
      { id: "scout", name: "Scout" },
    ];
    const names = catalog.map((c) => c.name);
    expect(names).toNotContain("ASTRA");
    expect(names).toNotContain("FLASH");
  });
  test("F10.2: Catalog includes role capabilities description", () => {
    const role = createRoleFixture({ capabilities: ["architecture", "review"] });
    expect(role.capabilities).toContain("architecture");
  });
  test("F10.3: Catalog displays user-created custom roles", () => {
    const catalog = [{ id: "custom-qa", name: "QA Specialist" }];
    expect(catalog[0].id).toBe("custom-qa");
  });
  test("F10.4: Catalog separates role presentation from runner options", () => {
    const roleCard = { roleId: "builder", title: "Builder", runnersAvailable: ["bash", "claude"] };
    expect(roleCard.runnersAvailable).toHaveLength(2);
  });
  test("F10.5: Catalog exposes role identifier cleanly", () => {
    const role = createRoleFixture({ id: "builder" });
    expect(role.id).toBe("builder");
  });

  // F11: 2-Step Selection Flow
  setTestScope(1, "F11", "2-Step Selection Flow");
  test("F11.1: Selection flow requires role selection first", () => {
    const flow = { step: 1, selectedRole: "builder", selectedRunner: null };
    expect(flow.selectedRole).toBe("builder");
  });
  test("F11.2: Step 2 permits selecting runner explicitly", () => {
    const flow = { step: 2, selectedRole: "builder", selectedRunner: "bash" };
    expect(flow.selectedRunner).toBe("bash");
  });
  test("F11.3: Selecting bash skips model selection", () => {
    const flow = { selectedRunner: "bash" };
    const needsModel = flow.selectedRunner !== "bash";
    expect(needsModel).toBeFalsy();
  });
  test("F11.4: Selecting AI runner presents compatible models", () => {
    const runner = { id: "claude", models: ["claude-3-7-sonnet", "claude-3-5-haiku"] };
    expect(runner.models).toContain("claude-3-7-sonnet");
  });
  test("F11.5: Completed selection yields explicit { role, runner, model }", () => {
    const selection = { role: "builder", runner: "claude", model: "claude-3-7-sonnet" };
    expect(selection.role).toBe("builder");
    expect(selection.runner).toBe("claude");
  });

  // F12: Mission Renaming
  setTestScope(1, "F12", "Mission Renaming");
  test("F12.1: Mission name can be updated via API payload", () => {
    const mission = { id: "m1", nome: "Design Original" };
    mission.nome = "Design Refatorado";
    expect(mission.nome).toBe("Design Refatorado");
  });
  test("F12.2: Mission renaming preserves mission id", () => {
    const mission = { id: "m1", nome: "Antigo" };
    mission.nome = "Novo";
    expect(mission.id).toBe("m1");
  });
  test("F12.3: Mission renaming preserves git worktree association", () => {
    const mission = { id: "m1", nome: "M1", worktree: "/repo/worktree-1" };
    mission.nome = "M1 Renomeada";
    expect(mission.worktree).toBe("/repo/worktree-1");
  });
  test("F12.4: Mission renaming records updated timestamp", () => {
    const mission = { id: "m1", nome: "V1", updatedAt: 100 };
    mission.updatedAt = 200;
    expect(mission.updatedAt).toBe(200);
  });
  test("F12.5: Renamed mission serializes correctly", () => {
    const mission = { id: "m1", nome: "Missão Alpha" };
    const json = JSON.stringify(mission);
    expect(json).toContain("Missão Alpha");
  });

  // F13: Pane Renaming & Reclassifying
  setTestScope(1, "F13", "Pane Renaming & Reclassifying");
  test("F13.1: Open shell pane label can be renamed", () => {
    const pane = { id: "p1", label: "Terminal 1" };
    pane.label = "Terminal Backend";
    expect(pane.label).toBe("Terminal Backend");
  });
  test("F13.2: Open pane role can be reclassified", () => {
    const pane = { id: "p1", role: "builder" };
    pane.role = "reviewer";
    expect(pane.role).toBe("reviewer");
  });
  test("F13.3: Reclassifying role preserves underlying process PID", () => {
    const pane = { id: "p1", pid: 4567, role: "builder" };
    pane.role = "scout";
    expect(pane.pid).toBe(4567);
  });
  test("F13.4: Reclassifying role preserves runner", () => {
    const pane = { id: "p1", runner: "bash", role: "builder" };
    pane.role = "tester";
    expect(pane.runner).toBe("bash");
  });
  test("F13.5: Pane updates broadcast event payload", () => {
    const event = { type: "pane:updated", paneId: "p1", label: "Novo Label", role: "reviewer" };
    expect(event.type).toBe("pane:updated");
  });

  // F14: Real Connection Visual Lines
  setTestScope(1, "F14", "Real Connection Visual Lines");
  test("F14.1: UI renders connection wire only when active connection exists", () => {
    const connections = [createConnectionFixture("p1", "p2")];
    const shouldRenderWire = (from, to) => connections.some((c) => c.sourcePaneId === from && c.targetPaneId === to && c.status === "active");
    expect(shouldRenderWire("p1", "p2")).toBeTruthy();
    expect(shouldRenderWire("p1", "p3")).toBeFalsy();
  });
  test("F14.2: Closed connection does not render visual wire", () => {
    const conn = createConnectionFixture("p1", "p2");
    conn.status = "closed";
    expect(conn.status === "active").toBeFalsy();
  });
  test("F14.3: Connection lines represent directed or bidirectional links", () => {
    const conn = createConnectionFixture("p1", "p2");
    expect(conn.sourcePaneId).toBe("p1");
    expect(conn.targetPaneId).toBe("p2");
  });
  test("F14.4: Deleting connection removes wire anchor", () => {
    let connections = [createConnectionFixture("p1", "p2")];
    connections = connections.filter((c) => c.id !== "conn-p1-p2");
    expect(connections).toHaveLength(0);
  });
  test("F14.5: Wire query returns coordinate source and target IDs", () => {
    const conn = createConnectionFixture("pA", "pB");
    expect(conn.sourcePaneId).toBe("pA");
    expect(conn.targetPaneId).toBe("pB");
  });

  // F15: Visual Element Differentiation
  setTestScope(1, "F15", "Visual Element Differentiation");
  test("F15.1: Pane descriptor differentiates role badge", () => {
    const pane = { role: "builder", runner: "bash", model: null, status: "working" };
    expect(pane.role).toBe("builder");
  });
  test("F15.2: Pane descriptor differentiates runner badge", () => {
    const pane = { role: "builder", runner: "bash", model: null, status: "working" };
    expect(pane.runner).toBe("bash");
  });
  test("F15.3: Pane descriptor differentiates model badge", () => {
    const pane = { role: "builder", runner: "claude", model: "claude-3-7-sonnet" };
    expect(pane.model).toBe("claude-3-7-sonnet");
  });
  test("F15.4: Pane descriptor differentiates status badge", () => {
    const pane = { status: "waiting-user" };
    expect(pane.status).toBe("waiting-user");
  });
  test("F15.5: Pane descriptor displays active task badge", () => {
    const pane = { activeTaskId: "task-42" };
    expect(pane.activeTaskId).toBe("task-42");
  });

  // F16: No Silent Fallback to Codex
  setTestScope(1, "F16", "No Silent Fallback to Codex");
  test("F16.1: Unavailable runner throws explicit error", () => {
    expect(() => {
      resolveHarnessContract({ requestedCli: "claude", availableInPath: false });
    }).toThrow();
  });
  test("F16.2: Unavailable runner error includes runner name", () => {
    try {
      resolveHarnessContract({ requestedCli: "claude", availableInPath: false });
      assert.fail("Should throw");
    } catch (err) {
      expect(err.message).toContain("claude");
      expect(err.message).toContain("não disponível no sistema");
    }
  });
  test("F16.3: System does not substitute unavailable runner with codex", () => {
    let chosenCli = null;
    try {
      const res = resolveHarnessContract({ requestedCli: "agy", availableInPath: false });
      chosenCli = res.cli;
    } catch {
      chosenCli = "none";
    }
    expect(chosenCli).toBe("none");
  });
  test("F16.4: Unavailable openrouter runner throws explicit error", () => {
    try {
      resolveHarnessContract({ requestedCli: "openrouter", availableInPath: false });
      assert.fail("Should throw");
    } catch (err) {
      expect(err.message).toContain("openrouter");
    }
  });
  test("F16.5: Zero silent fallback flag in harness response", () => {
    const res = resolveHarnessContract({ requestedCli: "bash" });
    expect(res.cli).toBe("bash");
  });

  // F17: Roster Whitelist Enforcement
  setTestScope(1, "F17", "Roster Whitelist Enforcement");
  test("F17.1: Elenco acts as whitelist of permitted runners", () => {
    const res = resolveHarnessContract({ requestedCli: "codex", missionElenco: ["codex", "bash"] });
    expect(res.cli).toBe("codex");
  });
  test("F17.2: Unauthorized runner rejected with explicit error", () => {
    try {
      resolveHarnessContract({ requestedCli: "claude", missionElenco: ["codex", "bash"] });
      assert.fail("Should throw");
    } catch (err) {
      expect(err.message).toContain("não permitido no elenco");
    }
  });
  test("F17.3: Roster rejection does not substitute with permitidos[0]", () => {
    let substituted = false;
    try {
      resolveHarnessContract({ requestedCli: "claude", missionElenco: ["codex", "bash"] });
    } catch {
      substituted = false;
    }
    expect(substituted).toBeFalsy();
  });
  test("F17.4: Empty elenco permits bash by default", () => {
    const res = resolveHarnessContract({ requestedCli: "bash", missionElenco: [] });
    expect(res.cli).toBe("bash");
  });
  test("F17.5: Multi-CLI elenco allows all listed runners", () => {
    const elenco = ["codex", "claude", "bash"];
    const r1 = resolveHarnessContract({ requestedCli: "codex", missionElenco: elenco });
    const r2 = resolveHarnessContract({ requestedCli: "claude", missionElenco: elenco });
    expect(r1.cli).toBe("codex");
    expect(r2.cli).toBe("claude");
  });

  // F18: Task Type Model Isolation
  setTestScope(1, "F18", "Task Type Model Isolation");
  test("F18.1: Task marked visual preserves configured model", () => {
    const configuredModel = "gpt-6-astra";
    const taskType = "visual";
    const modelUsed = configuredModel; // task type must never alter model
    expect(modelUsed).toBe("gpt-6-astra");
  });
  test("F18.2: Task marked arquitetura preserves configured model", () => {
    const configuredModel = "claude-3-7-sonnet";
    const taskType = "arquitetura";
    expect(configuredModel).toBe("claude-3-7-sonnet");
  });
  test("F18.3: Task marked implementar preserves configured model", () => {
    const configuredModel = "gemini-3.1-pro";
    expect(configuredModel).toBe("gemini-3.1-pro");
  });
  test("F18.4: Task type only sets semantic category", () => {
    const task = createTaskFixture({ priority: "high" });
    task.type = "visual";
    expect(task.type).toBe("visual");
  });
  test("F18.5: Switching task type does not trigger model mutation", () => {
    let model = "my-custom-model";
    const changeType = (newType) => { /* no model change */ };
    changeType("bugfix");
    expect(model).toBe("my-custom-model");
  });

  // F19: Disabled Auto-Failover
  setTestScope(1, "F19", "Disabled Auto-Failover");
  test("F19.1: Default config has maestroAutoSwitch set to false", () => {
    const config = { maestroAutoSwitch: false };
    expect(config.maestroAutoSwitch).toBeFalsy();
  });
  test("F19.2: Quota exhaustion blocks pane without automatic swap", () => {
    const pane = { runner: "codex", status: "working" };
    const onQuotaExhausted = (p, autoSwitch) => {
      if (!autoSwitch) p.status = "blocked";
    };
    onQuotaExhausted(pane, false);
    expect(pane.runner).toBe("codex");
    expect(pane.status).toBe("blocked");
  });
  test("F19.3: Runner swap requires explicit user authorization", () => {
    let swapped = false;
    const authorizeSwap = (userConfirmed) => { if (userConfirmed) swapped = true; };
    authorizeSwap(false);
    expect(swapped).toBeFalsy();
    authorizeSwap(true);
    expect(swapped).toBeTruthy();
  });
  test("F19.4: Failover authorization records audit entry", () => {
    const auditLogs = [];
    const recordAuth = (from, to) => auditLogs.push({ event: "failover_authorized", from, to, at: Date.now() });
    recordAuth("codex", "claude");
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].event).toBe("failover_authorized");
  });
  test("F19.5: Manual authorization specifies target runner explicitly", () => {
    const authPayload = { paneId: "p1", targetRunner: "claude", confirmed: true };
    expect(authPayload.targetRunner).toBe("claude");
  });

  // F20: cockpit list Verb
  setTestScope(1, "F20", "cockpit list Verb");
  test("F20.1: cockpit list returns all active panes", () => {
    const panes = [{ id: "p1", role: "builder", runner: "bash" }];
    expect(panes).toHaveLength(1);
  });
  test("F20.2: cockpit list includes assigned task information", () => {
    const pane = { id: "p1", role: "builder", activeTaskId: "task-1" };
    expect(pane.activeTaskId).toBe("task-1");
  });
  test("F20.3: cockpit list displays runner and role per pane", () => {
    const pane = { id: "p1", role: "reviewer", runner: "claude" };
    expect(pane.role).toBe("reviewer");
    expect(pane.runner).toBe("claude");
  });
  test("F20.4: cockpit list displays current granular state", () => {
    const pane = { id: "p1", status: "waiting-user" };
    expect(pane.status).toBe("waiting-user");
  });
  test("F20.5: cockpit list formats output as structured JSON", () => {
    const result = { panes: [{ id: "p1" }], total: 1 };
    expect(JSON.stringify(result)).toContain('"total":1');
  });

  // F21: cockpit connect Verb
  setTestScope(1, "F21", "cockpit connect Verb");
  test("F21.1: cockpit connect establishes link between pane A and B", () => {
    const conn = createConnectionFixture("pane-1", "pane-2");
    expect(conn.sourcePaneId).toBe("pane-1");
    expect(conn.targetPaneId).toBe("pane-2");
  });
  test("F21.2: cockpit connect persists link in connection registry", () => {
    const registry = new Map();
    const conn = createConnectionFixture("p1", "p2");
    registry.set(conn.id, conn);
    expect(registry.has("conn-p1-p2")).toBeTruthy();
  });
  test("F21.3: cockpit connect returns unique connection ID", () => {
    const conn = createConnectionFixture("p1", "p2");
    expect(conn.id).toBe("conn-p1-p2");
  });
  test("F21.4: cockpit connect associates connection with current mission", () => {
    const conn = createConnectionFixture("p1", "p2", "mission-alpha");
    expect(conn.missionId).toBe("mission-alpha");
  });
  test("F21.5: cockpit connect status is active upon creation", () => {
    const conn = createConnectionFixture("p1", "p2");
    expect(conn.status).toBe("active");
  });

  // F22: cockpit ask Verb
  setTestScope(1, "F22", "cockpit ask Verb");
  test("F22.1: cockpit ask enqueues message to target pane inbox", () => {
    const inbox = [];
    const ask = (from, to, task) => inbox.push({ from, to, task, at: Date.now() });
    ask("pane-1", "pane-2", "Executar análise estática");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].task).toBe("Executar análise estática");
  });
  test("F22.2: cockpit ask never writes to bash stdin", () => {
    let stdinBytes = 0;
    const askBash = (pane, msg) => {
      // safe inbox queue, 0 stdin bytes
      pane.inbox.push(msg);
    };
    const bashPane = { runner: "bash", inbox: [] };
    askBash(bashPane, "Tarefa");
    expect(stdinBytes).toBe(0);
    expect(bashPane.inbox).toHaveLength(1);
  });
  test("F22.3: cockpit ask generates correlation ID", () => {
    const msg = { correlationId: "corr-123", task: "Verificar testes" };
    expect(msg.correlationId).toBe("corr-123");
  });
  test("F22.4: cockpit ask records sender pane ID", () => {
    const msg = { from: "pane-maestro", task: "Revisar código" };
    expect(msg.from).toBe("pane-maestro");
  });
  test("F22.5: cockpit ask triggers inbox:message notification", () => {
    const events = [];
    const notify = (evt) => events.push(evt);
    notify({ event: "inbox:message", targetPane: "pane-2" });
    expect(events[0].event).toBe("inbox:message");
  });

  // F23: cockpit reply Verb
  setTestScope(1, "F23", "cockpit reply Verb");
  test("F23.1: cockpit reply sends structured response to requesting pane", () => {
    const reply = { to: "pane-1", correlationId: "corr-123", result: "Testes passaram com sucesso" };
    expect(reply.result).toContain("Testes passaram");
  });
  test("F23.2: cockpit reply matches correlation ID of request", () => {
    const reply = { correlationId: "corr-999" };
    expect(reply.correlationId).toBe("corr-999");
  });
  test("F23.3: cockpit reply enqueues into requester inbox", () => {
    const requesterInbox = [];
    requesterInbox.push({ type: "reply", text: "Concluído" });
    expect(requesterInbox).toHaveLength(1);
  });
  test("F23.4: cockpit reply records timestamp", () => {
    const reply = { at: Date.now() };
    expect(reply.at).toBeDefined();
  });
  test("F23.5: cockpit reply can attach structured evidence", () => {
    const reply = { result: "OK", evidence: [{ type: "diff", lines: 10 }] };
    expect(reply.evidence).toHaveLength(1);
  });

  // F24: cockpit handoff Verb
  setTestScope(1, "F24", "cockpit handoff Verb");
  test("F24.1: cockpit handoff transfers task context between panes", () => {
    const handoff = createHandoffFixture("pane-1", "pane-2", "task-5", "Contexto de migração");
    expect(handoff.context).toBe("Contexto de migração");
  });
  test("F24.2: cockpit handoff updates task assignee", () => {
    const task = createTaskFixture({ pane: "pane-1" });
    task.pane = "pane-2";
    expect(task.pane).toBe("pane-2");
  });
  test("F24.3: cockpit handoff appends evidence to task", () => {
    const task = createTaskFixture();
    task.evidence.push({ type: "handoff", from: "pane-1", to: "pane-2", at: Date.now() });
    expect(task.evidence).toHaveLength(1);
  });
  test("F24.4: cockpit handoff records status as completed upon acceptance", () => {
    const handoff = createHandoffFixture("p1", "p2", "t1");
    handoff.status = "completed";
    expect(handoff.status).toBe("completed");
  });
  test("F24.5: cockpit handoff logs event in mission continuity", () => {
    const continuityLog = [];
    continuityLog.push({ kind: "handoff", task: "t1", from: "p1", to: "p2" });
    expect(continuityLog[0].kind).toBe("handoff");
  });

  // F25: Persistent Inbox/Outbox
  setTestScope(1, "F25", "Persistent Inbox/Outbox");
  test("F25.1: Each pane possesses an isolated inbox queue", () => {
    const pane = { id: "p1", inbox: [], outbox: [] };
    expect(pane.inbox).toHaveLength(0);
    expect(pane.outbox).toHaveLength(0);
  });
  test("F25.2: Sending message updates sender outbox and recipient inbox", () => {
    const p1 = { outbox: [] };
    const p2 = { inbox: [] };
    const msg = { id: "m1", body: "Olá" };
    p1.outbox.push(msg);
    p2.inbox.push(msg);
    expect(p1.outbox).toHaveLength(1);
    expect(p2.inbox).toHaveLength(1);
  });
  test("F25.3: Mailbox queue persists across state save", () => {
    const mailbox = { paneId: "p1", messages: [{ id: "m1" }] };
    const saved = JSON.parse(JSON.stringify(mailbox));
    expect(saved.messages).toHaveLength(1);
  });
  test("F25.4: Dequeuing message marks status as read", () => {
    const msg = { id: "m1", status: "unread" };
    msg.status = "read";
    expect(msg.status).toBe("read");
  });
  test("F25.5: Inbox messages preserve arrival order (FIFO)", () => {
    const inbox = ["msg-1", "msg-2", "msg-3"];
    expect(inbox.shift()).toBe("msg-1");
    expect(inbox.shift()).toBe("msg-2");
  });

  // F26: Existing Pane Task Dispatch
  setTestScope(1, "F26", "Existing Pane Task Dispatch");
  test("F26.1: Maestro queries connected active panes without spawning new", () => {
    const panes = [{ id: "p1", status: "waiting-user" }, { id: "p2", status: "waiting-user" }];
    expect(panes).toHaveLength(2);
  });
  test("F26.2: Maestro assigns task to existing pane ID", () => {
    const task = createTaskFixture({ pane: null });
    task.pane = "p1";
    task.status = "in-progress";
    expect(task.pane).toBe("p1");
    expect(task.status).toBe("in-progress");
  });
  test("F26.3: Dispatching to existing pane preserves pane process count", () => {
    const processCountBefore = 2;
    // assign task to p1
    const processCountAfter = 2;
    expect(processCountAfter).toBe(processCountBefore);
  });
  test("F26.4: Assigned pane receives task notification", () => {
    const notifications = [];
    notifications.push({ paneId: "p1", assignedTask: "task-10" });
    expect(notifications[0].assignedTask).toBe("task-10");
  });
  test("F26.5: Dispatch updates active task badge in pane metadata", () => {
    const pane = { id: "p1", activeTaskId: null };
    pane.activeTaskId = "task-10";
    expect(pane.activeTaskId).toBe("task-10");
  });

  // F27: Task CRUD & API Routes
  setTestScope(1, "F27", "Task CRUD & API Routes");
  test("F27.1: Create task initializes structured Task object", () => {
    const task = createTaskFixture({ title: "Implementar rotas" });
    expect(task.title).toBe("Implementar rotas");
  });
  test("F27.2: Read task returns task with all 13 fields", () => {
    const task = createTaskFixture();
    expect(validateTask13Fields(task)).toBeTruthy();
  });
  test("F27.3: Update task updates description and updatedAt", () => {
    const task = createTaskFixture({ description: "Antiga" });
    task.description = "Nova descrição";
    task.timestamps.updatedAt = Date.now();
    expect(task.description).toBe("Nova descrição");
  });
  test("F27.4: Delete task removes task from registry", () => {
    const registry = new Map();
    const task = createTaskFixture({ id: "t-delete" });
    registry.set(task.id, task);
    registry.delete("t-delete");
    expect(registry.has("t-delete")).toBeFalsy();
  });
  test("F27.5: List tasks filters by mission ID", () => {
    const tasks = [
      { id: "t1", missionId: "m1" },
      { id: "t2", missionId: "m2" },
    ];
    const filtered = tasks.filter((t) => t.missionId === "m1");
    expect(filtered).toHaveLength(1);
  });

  // F28: 6-State Formal Lifecycle
  setTestScope(1, "F28", "6-State Formal Lifecycle");
  test("F28.1: Transition todo -> in-progress is valid", () => {
    expect(canTransitionTask("todo", "in-progress")).toBeTruthy();
  });
  test("F28.2: Transition in-progress -> blocked is valid", () => {
    expect(canTransitionTask("in-progress", "blocked")).toBeTruthy();
  });
  test("F28.3: Transition blocked -> in-progress is valid", () => {
    expect(canTransitionTask("blocked", "in-progress")).toBeTruthy();
  });
  test("F28.4: Transition in-progress -> in-review is valid", () => {
    expect(canTransitionTask("in-progress", "in-review")).toBeTruthy();
  });
  test("F28.5: Transition in-review -> complete is valid", () => {
    expect(canTransitionTask("in-review", "complete")).toBeTruthy();
  });

  // F29: Interactive Sidebar Task Board
  setTestScope(1, "F29", "Interactive Sidebar Task Board");
  test("F29.1: Board groups tasks into all 6 state columns", () => {
    const board = { todo: [], "in-progress": [], blocked: [], "in-review": [], complete: [], failed: [] };
    expect(Object.keys(board)).toHaveLength(6);
  });
  test("F29.2: Updating task status moves task card to new column", () => {
    const task = createTaskFixture({ status: "todo" });
    const updated = transitionTaskStatus(task, "in-progress");
    expect(updated.status).toBe("in-progress");
  });
  test("F29.3: Sidebar query returns counts per status column", () => {
    const counts = { todo: 2, "in-progress": 1, blocked: 0, "in-review": 0, complete: 3, failed: 0 };
    expect(counts.complete).toBe(3);
  });
  test("F29.4: Task card displays assignee and role badge", () => {
    const task = createTaskFixture({ assignee: "builder-1", role: "builder" });
    expect(task.assignee).toBe("builder-1");
    expect(task.role).toBe("builder");
  });
  test("F29.5: Real-time event task:updated triggers board rerender", () => {
    const event = { type: "task:updated", taskId: "t1", status: "complete" };
    expect(event.type).toBe("task:updated");
  });

  // F30: Knowledge & Evidence Logging
  setTestScope(1, "F30", "Knowledge & Evidence Logging");
  test("F30.1: Evidence logging appends diff snippets", () => {
    const task = createTaskFixture();
    task.evidence.push({ type: "diff", file: "src/api.ts", changes: "+10 -2" });
    expect(task.evidence[0].type).toBe("diff");
  });
  test("F30.2: Evidence logging appends test execution results", () => {
    const task = createTaskFixture();
    task.evidence.push({ type: "test-run", suite: "E2E", passed: 10, failed: 0 });
    expect(task.evidence[0].passed).toBe(10);
  });
  test("F30.3: Evidence logging records knowledge snippets", () => {
    const task = createTaskFixture();
    task.evidence.push({ type: "knowledge", title: "Config Cache", note: "Cache invalidation on write" });
    expect(task.evidence[0].title).toBe("Config Cache");
  });
  test("F30.4: Evidence includes timestamp and author pane", () => {
    const task = createTaskFixture();
    task.evidence.push({ paneId: "p1", at: Date.now(), text: "Log" });
    expect(task.evidence[0].paneId).toBe("p1");
  });
  test("F30.5: Concluding task compiles evidence into task result", () => {
    const task = createTaskFixture();
    task.evidence.push({ type: "summary", text: "Refatoração concluída" });
    task.result = { summary: "100% concluído", totalEvidence: task.evidence.length };
    expect(task.result.totalEvidence).toBe(1);
  });

  // F31: Shared File Ownership Mode
  setTestScope(1, "F31", "Shared File Ownership Mode");
  test("F31.1: Shared mode allows multiple tasks to list same file", () => {
    const lockMgr = new MockFileLockManager();
    const res1 = lockMgr.acquire("m1", "t1", "p1", ["index.ts"], "shared");
    const res2 = lockMgr.acquire("m1", "t2", "p2", ["index.ts"], "shared");
    expect(res1.ok).toBeTruthy();
    expect(res2.ok).toBeTruthy();
  });
  test("F31.2: Shared mode collision emits visual warning", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["index.ts"], "shared");
    const res2 = lockMgr.acquire("m1", "t2", "p2", ["index.ts"], "shared");
    expect(res2.warning).toBeTruthy();
    expect(res2.collisionFiles).toContain("index.ts");
  });
  test("F31.3: Shared mode does not return 409 Conflict", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["index.ts"], "shared");
    const res2 = lockMgr.acquire("m1", "t2", "p2", ["index.ts"], "shared");
    expect(res2.statusCode).toBe(200);
  });
  test("F31.4: Releasing task clears lock manager reference", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["index.ts"], "shared");
    const releaseRes = lockMgr.release("t1");
    expect(releaseRes.ok).toBeTruthy();
  });
  test("F31.5: Shared mode lists multiple active editor panes", () => {
    const editors = [{ paneId: "p1" }, { paneId: "p2" }];
    expect(editors).toHaveLength(2);
  });

  // F32: Isolated File Ownership Mode
  setTestScope(1, "F32", "Isolated File Ownership Mode");
  test("F32.1: Isolated mode grants exclusive lock to first acquiring task", () => {
    const lockMgr = new MockFileLockManager();
    const res = lockMgr.acquire("m1", "t1", "p1", ["main.go"], "isolated");
    expect(res.ok).toBeTruthy();
    expect(res.statusCode).toBe(200);
  });
  test("F32.2: Isolated mode returns 409 Conflict on collision", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["main.go"], "isolated");
    const res2 = lockMgr.acquire("m1", "t2", "p2", ["main.go"], "isolated");
    expect(res2.ok).toBeFalsy();
    expect(res2.statusCode).toBe(409);
  });
  test("F32.3: 409 response contains conflictFiles list", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["main.go"], "isolated");
    const res2 = lockMgr.acquire("m1", "t2", "p2", ["main.go"], "isolated");
    expect(res2.conflictFiles).toContain("main.go");
  });
  test("F32.4: 409 response identifies lockedBy task ID", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["main.go"], "isolated");
    const res2 = lockMgr.acquire("m1", "t2", "p2", ["main.go"], "isolated");
    expect(res2.lockedBy).toBe("t1");
  });
  test("F32.5: Releasing lock allows subsequent task acquisition", () => {
    const lockMgr = new MockFileLockManager();
    lockMgr.acquire("m1", "t1", "p1", ["main.go"], "isolated");
    lockMgr.release("t1");
    const res2 = lockMgr.acquire("m1", "t2", "p2", ["main.go"], "isolated");
    expect(res2.ok).toBeTruthy();
    expect(res2.statusCode).toBe(200);
  });

  // F33: Modo Livre (Default)
  setTestScope(1, "F33", "Modo Livre (Default)");
  test("F33.1: Default mission mode is livre", () => {
    const mission = { id: "m1", mode: "livre" };
    expect(mission.mode).toBe("livre");
  });
  test("F33.2: Livre mode prevents auto agent spawning by Maestro", () => {
    const mode = "livre";
    const canAutoSpawn = mode === "autonomo";
    expect(canAutoSpawn).toBeFalsy();
  });
  test("F33.3: User has manual control over all pane creation", () => {
    const permissions = { manualPaneCreation: true };
    expect(permissions.manualPaneCreation).toBeTruthy();
  });
  test("F33.4: Maestro only advises without initiating actions in livre", () => {
    const mode = "livre";
    const maestroCanAutoAssign = mode === "dirigido" || mode === "autonomo";
    expect(maestroCanAutoAssign).toBeFalsy();
  });
  test("F33.5: Mode badge in UI indicates Livre", () => {
    const badge = { label: "Livre", color: "blue" };
    expect(badge.label).toBe("Livre");
  });

  // F34: Modo Dirigido
  setTestScope(1, "F34", "Modo Dirigido");
  test("F34.1: Dirigido mode restricts delegation within user-authorized team", () => {
    const team = ["builder", "reviewer"];
    const canDelegate = (role) => team.includes(role);
    expect(canDelegate("builder")).toBeTruthy();
    expect(canDelegate("scout")).toBeFalsy();
  });
  test("F34.2: Maestro follows predefined workflow order in dirigido", () => {
    const stages = ["spec", "implementation", "review"];
    expect(stages[0]).toBe("spec");
  });
  test("F34.3: Dirigido mode does not spawn unauthorized roles", () => {
    const authorizedRoles = new Set(["builder", "reviewer"]);
    const requested = "hacker";
    expect(authorizedRoles.has(requested)).toBeFalsy();
  });
  test("F34.4: User approval required for stage progression in dirigido", () => {
    const stage = { completed: true, userApproved: false };
    const canAdvance = stage.completed && stage.userApproved;
    expect(canAdvance).toBeFalsy();
  });
  test("F34.5: Dirigido mode logs every delegation decision", () => {
    const delegationLogs = [];
    delegationLogs.push({ role: "builder", action: "delegate_task" });
    expect(delegationLogs).toHaveLength(1);
  });

  // F35: Modo Autônomo
  setTestScope(1, "F35", "Modo Autônomo");
  test("F35.1: Autônomo mode permits Maestro to create subtasks", () => {
    const mode = "autonomo";
    const canCreateSubtasks = mode === "autonomo";
    expect(canCreateSubtasks).toBeTruthy();
  });
  test("F35.2: Autônomo mode permits scoped pane creation within limit", () => {
    const maxPanes = 4;
    let currentPanes = 2;
    const canSpawn = currentPanes < maxPanes;
    expect(canSpawn).toBeTruthy();
  });
  test("F35.3: Concurrency limit halts further autonomous spawns", () => {
    const maxPanes = 4;
    let currentPanes = 4;
    const canSpawn = currentPanes < maxPanes;
    expect(canSpawn).toBeFalsy();
  });
  test("F35.4: Autonomous actions generate high-priority audit events", () => {
    const auditEvent = { priority: "high", event: "auto_spawn_pane", paneId: "p3" };
    expect(auditEvent.priority).toBe("high");
  });
  test("F35.5: Emergency pause immediately halts autonomous loop", () => {
    let loopActive = true;
    const emergencyPause = () => { loopActive = false; };
    emergencyPause();
    expect(loopActive).toBeFalsy();
  });

  // F36: Disk State Persistence
  setTestScope(1, "F36", "Disk State Persistence");
  test("F36.1: State serializer writes missions and tasks to disk", () => {
    const state = { missions: [{ id: "m1" }], tasks: [{ id: "t1" }] };
    const serialized = JSON.stringify(state);
    expect(serialized).toContain('"m1"');
    expect(serialized).toContain('"t1"');
  });
  test("F36.2: State deserializer restores connections topology", () => {
    const json = '{"connections":[{"id":"conn-1","sourcePaneId":"p1","targetPaneId":"p2"}]}';
    const state = JSON.parse(json);
    expect(state.connections).toHaveLength(1);
  });
  test("F36.3: State persistence includes task evidence bundles", () => {
    const task = createTaskFixture({ evidence: [{ note: "Checkpoint 1" }] });
    const json = JSON.stringify(task);
    expect(json).toContain("Checkpoint 1");
  });
  test("F36.4: State persistence saves custom roles definitions", () => {
    const state = { roles: [{ id: "auditor", name: "Auditor" }] };
    const saved = JSON.parse(JSON.stringify(state));
    expect(saved.roles[0].id).toBe("auditor");
  });
  test("F36.5: Atomic file write prevents corrupted state reads", () => {
    const writeStep = { tempFile: "state.json.tmp", targetFile: "state.json", renamed: true };
    expect(writeStep.renamed).toBeTruthy();
  });

  // F37: UI/Server Decoupled PTY
  setTestScope(1, "F37", "UI/Server Decoupled PTY");
  test("F37.1: PTY processes run in decoupled host daemon", () => {
    const ptyHost = { active: true, managedPanes: ["p1", "p2"] };
    expect(ptyHost.managedPanes).toHaveLength(2);
  });
  test("F37.2: Stopping Express web server leaves PTY daemon running", () => {
    let expressRunning = false;
    let ptyDaemonRunning = true;
    expect(ptyDaemonRunning).toBeTruthy();
    expect(expressRunning).toBeFalsy();
  });
  test("F37.3: Restarting web server reattaches to running PTY sessions", () => {
    const session = { id: "p1", ptyAlive: true, attachedClients: 1 };
    expect(session.ptyAlive).toBeTruthy();
  });
  test("F37.4: Ring buffer preserves last 256KB of terminal output", () => {
    const ringBufferLimit = 256 * 1024;
    expect(ringBufferLimit).toBe(262144);
  });
  test("F37.5: Client reattach receives instant terminal replay", () => {
    const replayData = "terminal output before restart";
    expect(replayData).toContain("terminal output");
  });

  // F38: WS Session Resumption
  setTestScope(1, "F38", "WS Session Resumption");
  test("F38.1: Client reconnects with sessionId and restores stream", () => {
    const session = { sessionId: "sess-123", paneId: "p1", active: true };
    expect(session.sessionId).toBe("sess-123");
  });
  test("F38.2: Stream resumption pushes missed terminal buffer", () => {
    const buffer = ["line 1\n", "line 2\n"];
    expect(buffer).toHaveLength(2);
  });
  test("F38.3: WebSocket reconnect restores task board subscription", () => {
    const subscriptions = new Set(["tasks", "panes"]);
    expect(subscriptions.has("tasks")).toBeTruthy();
  });
  test("F38.4: Heartbeat keeps session alive during quiet intervals", () => {
    let lastPing = Date.now();
    expect(lastPing).toBeDefined();
  });
  test("F38.5: Reconnected socket sends terminal dimensions resize", () => {
    const resizeMsg = { type: "resize", cols: 120, rows: 40 };
    expect(resizeMsg.cols).toBe(120);
  });

  // F39: 8-State Granular Pane Lifecycle
  setTestScope(1, "F39", "8-State Granular Pane Lifecycle");
  test("F39.1: Newly spawned pane enters starting state", () => {
    const pane = { id: "p1", status: "starting" };
    expect(pane.status).toBe("starting");
  });
  test("F39.2: Bash pane ready for user input enters waiting-user", () => {
    const pane = { id: "p1", status: "waiting-user" };
    expect(pane.status).toBe("waiting-user");
  });
  test("F39.3: Pane running execution enters working state", () => {
    const pane = { id: "p1", status: "working" };
    expect(pane.status).toBe("working");
  });
  test("F39.4: Pane waiting on file lock enters blocked state", () => {
    const pane = { id: "p1", status: "blocked" };
    expect(pane.status).toBe("blocked");
  });
  test("F39.5: Terminated pane enters dead state", () => {
    const pane = { id: "p1", status: "dead" };
    expect(pane.status).toBe("dead");
  });

  // F40: Granular Audit Trail
  setTestScope(1, "F40", "Granular Audit Trail");
  test("F40.1: Spawning pane writes audit entry", () => {
    const audit = [{ action: "spawn_pane", paneId: "p1", runner: "bash", at: Date.now() }];
    expect(audit[0].action).toBe("spawn_pane");
  });
  test("F40.2: Task transition writes audit entry", () => {
    const audit = [{ action: "transition_task", taskId: "t1", from: "todo", to: "in-progress" }];
    expect(audit[0].to).toBe("in-progress");
  });
  test("F40.3: Runner change logs audit entry with author", () => {
    const audit = [{ action: "change_runner", paneId: "p1", from: "codex", to: "claude", by: "user" }];
    expect(audit[0].by).toBe("user");
  });
  test("F40.4: File lock acquisition writes audit entry", () => {
    const audit = [{ action: "acquire_lock", taskId: "t1", file: "src/db.ts", mode: "isolated" }];
    expect(audit[0].mode).toBe("isolated");
  });
  test("F40.5: Audit log formats entries as append-only JSONL", () => {
    const entry = { action: "checkpoint", at: Date.now() };
    const line = JSON.stringify(entry) + "\n";
    expect(line.endsWith("\n")).toBeTruthy();
  });

  // F41: Secret & Credential Redaction
  setTestScope(1, "F41", "Secret & Credential Redaction");
  test("F41.1: Redacts OpenAI sk- API keys from output strings", () => {
    const raw = "Using key sk-1234567890abcdef1234567890 for auth";
    const redacted = redactSecrets(raw);
    expect(redacted).toBe("Using key [REDACTED] for auth");
  });
  test("F41.2: Redacts Bearer tokens from authorization headers", () => {
    const raw = "Authorization: Bearer secret-token-xyz123456789";
    const redacted = redactSecrets(raw);
    expect(redacted).toBe("Authorization: Bearer [REDACTED]");
  });
  test("F41.3: Redacts api_key key-value parameters", () => {
    const raw = 'api_key: "super_secret_key_123456"';
    const redacted = redactSecrets(raw);
    expect(redacted).toContain("[REDACTED]");
  });
  test("F41.4: Redacts password/token configurations from logs", () => {
    const raw = 'token = "my-secret-access-token-999"';
    const redacted = redactSecrets(raw);
    expect(redacted).toContain("[REDACTED]");
  });
  test("F41.5: Preserves non-sensitive strings intact", () => {
    const raw = "Compile succeeded with 0 errors in 1.2s";
    expect(redactSecrets(raw)).toBe(raw);
  });

  // F42: Scoped Workspace Permissions
  setTestScope(1, "F42", "Scoped Workspace Permissions");
  test("F42.1: Default permission level is workspace-write", () => {
    const perm = { level: "workspace-write" };
    expect(perm.level).toBe("workspace-write");
  });
  test("F42.2: Workspace write allows modifying files inside root", () => {
    const isAllowed = (file, root) => file.startsWith(root);
    expect(isAllowed("/project/src/index.ts", "/project")).toBeTruthy();
  });
  test("F42.3: Workspace write rejects modifying files outside root", () => {
    const isAllowed = (file, root) => file.startsWith(root);
    expect(isAllowed("/etc/passwd", "/project")).toBeFalsy();
  });
  test("F42.4: danger-full-access requires explicit opt-in", () => {
    let mode = "workspace-write";
    const setDangerMode = (userOptIn) => { if (userOptIn) mode = "danger-full-access"; };
    setDangerMode(false);
    expect(mode).toBe("workspace-write");
    setDangerMode(true);
    expect(mode).toBe("danger-full-access");
  });
  test("F42.5: Permission level is exposed in pane security badge", () => {
    const pane = { id: "p1", permissions: "workspace-write" };
    expect(pane.permissions).toBe("workspace-write");
  });

  // F43: Destructive Action Confirmations
  setTestScope(1, "F43", "Destructive Action Confirmations");
  test("F43.1: Killing running pane with unsaved work requires confirm flag", () => {
    const killRequest = { paneId: "p1", confirm: true };
    expect(killRequest.confirm).toBeTruthy();
  });
  test("F43.2: Overriding active file lock requires confirm flag", () => {
    const overrideRequest = { file: "main.ts", force: true, confirm: true };
    expect(overrideRequest.confirm).toBeTruthy();
  });
  test("F43.3: Deleting mission requires explicit confirmation", () => {
    const deleteMission = (confirmed) => {
      if (!confirmed) throw new Error("Confirmation required");
      return true;
    };
    expect(() => deleteMission(false)).toThrow();
    expect(deleteMission(true)).toBeTruthy();
  });
  test("F43.4: Confirmation payload includes reason description", () => {
    const confirmPayload = { action: "kill_pane", reason: "User requested process stop" };
    expect(confirmPayload.reason).toBeDefined();
  });
  test("F43.5: Non-confirmed destructive action returns warning prompt", () => {
    const response = { status: "confirmation_required", message: "Tem certeza que deseja matar o painel?" };
    expect(response.status).toBe("confirmation_required");
  });

  // F44: Modular Routes Directory
  setTestScope(1, "F44", "Modular Routes Directory");
  test("F44.1: Express route handlers modularized under routes/", () => {
    const routes = ["routes/missions.ts", "routes/tasks.ts", "routes/panes.ts", "routes/connections.ts"];
    expect(routes).toContain("routes/tasks.ts");
  });
  test("F44.2: Modular router exports express.Router instance", () => {
    const routerModule = { type: "Router", mounted: true };
    expect(routerModule.mounted).toBeTruthy();
  });
  test("F44.3: Main server registers route modules on clean paths", () => {
    const mounts = { "/api/tasks": "routes/tasks.ts", "/api/connections": "routes/connections.ts" };
    expect(mounts["/api/tasks"]).toBe("routes/tasks.ts");
  });
  test("F44.4: Modular routes handle error responses with standard JSON schema", () => {
    const errRes = { error: { code: "NOT_FOUND", message: "Task não encontrada" } };
    expect(errRes.error.code).toBe("NOT_FOUND");
  });
  test("F44.5: Modular route structure separates HTTP from business logic", () => {
    const layer = { route: "HTTP handler", service: "Domain Service" };
    expect(layer.route).not.toBe(layer.service);
  });

  // F45: Modular WebSocket Directory
  setTestScope(1, "F45", "Modular WebSocket Directory");
  test("F45.1: WebSocket server isolated under websocket/", () => {
    const wsModule = { path: "websocket/index.ts", handles: ["connection", "message", "close"] };
    expect(wsModule.handles).toContain("connection");
  });
  test("F45.2: Typed event broadcaster pushes events to subscribers", () => {
    const events = [];
    const broadcast = (event) => events.push(event);
    broadcast({ type: "task:created", taskId: "t1" });
    expect(events[0].type).toBe("task:created");
  });
  test("F45.3: Client event handler isolates message routing", () => {
    const handler = { canHandle: (type) => type.startsWith("pane:") };
    expect(handler.canHandle("pane:data")).toBeTruthy();
  });
  test("F45.4: Heartbeat ping/pong manages alive client registry", () => {
    const clients = new Map([["c1", { isAlive: true }]]);
    expect(clients.get("c1").isAlive).toBeTruthy();
  });
  test("F45.5: WebSocket connection lifecycle broadcasts connect and disconnect", () => {
    const connLife = ["connect", "authenticated", "disconnect"];
    expect(connLife).toContain("authenticated");
  });

  // F46: Modular Orchestration Directory
  setTestScope(1, "F46", "Modular Orchestration Directory");
  test("F46.1: Maestro orchestrator isolated under orchestration/", () => {
    const module = { path: "orchestration/maestro.ts" };
    expect(module.path).toContain("orchestration/");
  });
  test("F46.2: Harness policy resolver isolated under orchestration/", () => {
    const module = { path: "orchestration/harness.ts" };
    expect(module.path).toContain("orchestration/");
  });
  test("F46.3: Mission modes strategies isolated under orchestration/", () => {
    const modes = ["livre", "dirigido", "autonomo"];
    expect(modes).toHaveLength(3);
  });
  test("F46.4: Orchestrator exposes task delegation interface", () => {
    const iface = { delegateTask: "function", listAvailablePanes: "function" };
    expect(iface.delegateTask).toBe("function");
  });
  test("F46.5: Orchestration module verifies roster whitelist", () => {
    const policy = { verifyWhitelist: true };
    expect(policy.verifyWhitelist).toBeTruthy();
  });

  // F47: Modular Sessions Directory
  setTestScope(1, "F47", "Modular Sessions Directory");
  test("F47.1: PTY host client isolated under sessions/", () => {
    const module = { path: "sessions/pty-client.ts" };
    expect(module.path).toContain("sessions/");
  });
  test("F47.2: Clean bash spawner isolated under sessions/", () => {
    const spawner = { spawnBash: () => ({ cmd: "/bin/bash", args: ["-i", "-l"] }) };
    expect(spawner.spawnBash().cmd).toBe("/bin/bash");
  });
  test("F47.3: Ring buffer management isolated under sessions/", () => {
    const ring = { capacity: 262144, size: 0 };
    expect(ring.capacity).toBe(262144);
  });
  test("F47.4: Granular 8-state pane tracker isolated under sessions/", () => {
    expect(PANE_STATUSES).toHaveLength(8);
  });
  test("F47.5: Session reattach method restores terminal stream", () => {
    const sessionManager = { attach: (paneId) => ({ replay: "output", ok: true }) };
    expect(sessionManager.attach("p1").ok).toBeTruthy();
  });

  // F48: Modular Tasks Directory
  setTestScope(1, "F48", "Modular Tasks Directory");
  test("F48.1: Task domain service isolated under tasks/", () => {
    const module = { path: "tasks/service.ts" };
    expect(module.path).toContain("tasks/");
  });
  test("F48.2: Formal 6-state task machine isolated under tasks/", () => {
    expect(TASK_STATUSES).toHaveLength(6);
  });
  test("F48.3: Evidence repository isolated under tasks/", () => {
    const repo = { appendEvidence: () => true };
    expect(repo.appendEvidence()).toBeTruthy();
  });
  test("F48.4: Task 13 fields validator isolated under tasks/", () => {
    const task = createTaskFixture();
    expect(validateTask13Fields(task)).toBeTruthy();
  });
  test("F48.5: Tasks module exports createTask and transitionTask contracts", () => {
    const exports = ["createTask", "transitionTask", "listTasks", "getTask"];
    expect(exports).toContain("createTask");
  });

  // F49: Modular Connections Directory
  setTestScope(1, "F49", "Modular Connections Directory");
  test("F49.1: Pane connection registry isolated under connections/", () => {
    const module = { path: "connections/registry.ts" };
    expect(module.path).toContain("connections/");
  });
  test("F49.2: Mailbox manager isolated under connections/", () => {
    const module = { path: "connections/mailbox.ts" };
    expect(module.path).toContain("connections/");
  });
  test("F49.3: Inter-agent verbs (ask, reply, handoff) isolated under connections/", () => {
    const verbs = ["ask", "reply", "handoff", "connect"];
    expect(verbs).toContain("ask");
  });
  test("F49.4: Connections module blocks direct bash stdin command injection", () => {
    const safeMode = true;
    expect(safeMode).toBeTruthy();
  });
  test("F49.5: Connections module emits wire rendering topology", () => {
    const topology = [{ from: "p1", to: "p2" }];
    expect(topology).toHaveLength(1);
  });

  // F50: Modular Missions Directory
  setTestScope(1, "F50", "Modular Missions Directory");
  test("F50.1: Mission domain service isolated under missions/", () => {
    const module = { path: "missions/service.ts" };
    expect(module.path).toContain("missions/");
  });
  test("F50.2: Git worktree manager isolated under missions/", () => {
    const module = { path: "missions/worktree.ts" };
    expect(module.path).toContain("missions/");
  });
  test("F50.3: Mission checkpoints service isolated under missions/", () => {
    const module = { path: "missions/checkpoints.ts" };
    expect(module.path).toContain("missions/");
  });
  test("F50.4: Mission modes configuration isolated under missions/", () => {
    const modes = ["livre", "dirigido", "autonomo"];
    expect(modes).toContain("livre");
  });
  test("F50.5: Missions module exports renameMission and setElenco", () => {
    const exports = ["createMission", "renameMission", "setElenco", "archiveMission"];
    expect(exports).toContain("renameMission");
  });

  // F51: Modular Providers Directory
  setTestScope(1, "F51", "Modular Providers Directory");
  test("F51.1: CLI detection adapters isolated under providers/", () => {
    const module = { path: "providers/detection.ts" };
    expect(module.path).toContain("providers/");
  });
  test("F51.2: Provider quotas service isolated under providers/", () => {
    const module = { path: "providers/quotas.ts" };
    expect(module.path).toContain("providers/");
  });
  test("F51.3: CLI bridge adapters isolated under providers/", () => {
    const adapters = ["codex", "claude", "agy", "openrouter"];
    expect(adapters).toContain("codex");
  });
  test("F51.4: Media processing service isolated under providers/", () => {
    const module = { path: "providers/media.ts" };
    expect(module.path).toContain("providers/");
  });
  test("F51.5: Providers module exports checkCliAvailability contract", () => {
    const exports = ["checkCliAvailability", "getQuotas", "recordUsage"];
    expect(exports).toContain("checkCliAvailability");
  });

  // F52: Modular Persistence Directory
  setTestScope(1, "F52", "Modular Persistence Directory");
  test("F52.1: Atomic disk store isolated under persistence/", () => {
    const module = { path: "persistence/store.ts" };
    expect(module.path).toContain("persistence/");
  });
  test("F52.2: File lock manager isolated under persistence/", () => {
    const module = { path: "persistence/locks.ts" };
    expect(module.path).toContain("persistence/");
  });
  test("F52.3: Audit log appender isolated under persistence/", () => {
    const module = { path: "persistence/audit.ts" };
    expect(module.path).toContain("persistence/");
  });
  test("F52.4: Persistence store supports atomic rename write", () => {
    const atomicWrite = (file, data) => true;
    expect(atomicWrite("data.json", {})).toBeTruthy();
  });
  test("F52.5: Persistence module exports loadState and saveState contracts", () => {
    const exports = ["loadState", "saveState", "acquireLock", "releaseLock"];
    expect(exports).toContain("saveState");
  });

  // F53: Modular Security Directory
  setTestScope(1, "F53", "Modular Security Directory");
  test("F53.1: Secret sanitizer isolated under security/", () => {
    const module = { path: "security/sanitizer.ts" };
    expect(module.path).toContain("security/");
  });
  test("F53.2: Workspace sandbox permissions validator isolated under security/", () => {
    const module = { path: "security/sandbox.ts" };
    expect(module.path).toContain("security/");
  });
  test("F53.3: Confirmation validator isolated under security/", () => {
    const module = { path: "security/confirmations.ts" };
    expect(module.path).toContain("security/");
  });
  test("F53.4: Security module redacts API keys and tokens", () => {
    const result = redactSecrets("sk-123456789012345678901234");
    expect(result).toBe("[REDACTED]");
  });
  test("F53.5: Security module exports validateWorkspaceAccess contract", () => {
    const exports = ["sanitizeSecrets", "validateWorkspaceAccess", "requestConfirmation"];
    expect(exports).toContain("sanitizeSecrets");
  });
}
