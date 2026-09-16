import assert from "node:assert/strict";
import {
  type PaneState,
  type GranularPaneStatus,
  GRANULAR_PANE_STATES,
  normalizePaneStatus,
  ALLOWED_TRANSITIONS,
  canTransitionPane,
  transitionPane,
  isPaneActive,
  getPaneStatusLabel,
} from "../servidor/sessions/pane-state.ts";
import {
  PaneActivityTracker,
  DEFAULT_SPARKLINE_SLOTS,
  DEFAULT_IDLE_TIMEOUT_MS,
} from "../servidor/sessions/tracker.ts";

console.log("Running check-pane-states.ts (8-State Granular Pane Lifecycle & Tracker Verification)...");

function createMockPaneState(initialStatus: GranularPaneStatus = "starting"): PaneState {
  return {
    paneId: "pane-test-1",
    agent: "builder",
    label: "Builder",
    cor: "#3b82f6",
    cli: "claude",
    model: "claude-3-7-sonnet",
    effort: "high",
    tipo: "implementar",
    cwd: "/DATA/Projetos/agent-project",
    projectId: "proj-1",
    missionId: "miss-1",
    sessionId: "sess-1",
    maestro: false,
    status: initialStatus,
    bytesIn: 0,
    bytesOut: 0,
    iniciadoEm: Date.now() - 1000,
    atualizadoEm: Date.now() - 1000,
    atividade: PaneActivityTracker.createInitialSparkline(DEFAULT_SPARKLINE_SLOTS),
  };
}

// =========================================================================
// 1. 8-State Definitions & Normalization
// =========================================================================
console.log("  1. Verifying 8-state definitions & normalization...");
assert.equal(GRANULAR_PANE_STATES.length, 8, "GRANULAR_PANE_STATES must contain exactly 8 states");
const expectedStates: GranularPaneStatus[] = [
  "starting",
  "waiting-user",
  "working",
  "blocked",
  "review",
  "completed",
  "failed",
  "dead",
];
for (const st of expectedStates) {
  assert.ok(GRANULAR_PANE_STATES.includes(st), `Missing state: ${st}`);
  assert.equal(normalizePaneStatus(st), st, `Granular state ${st} must normalize to itself`);
}

assert.equal(normalizePaneStatus("run"), "working", "Legacy 'run' must normalize to 'working'");
assert.equal(normalizePaneStatus("idle"), "waiting-user", "Legacy 'idle' must normalize to 'waiting-user'");
console.log("  ✓ 8 states defined and legacy normalization verified");

// =========================================================================
// 2. Transition Matrix Enforcement (ALLOWED_TRANSITIONS)
// =========================================================================
console.log("  2. Verifying transition matrix enforcement...");

// Legal transitions
for (const fromState of GRANULAR_PANE_STATES) {
  const allowed = ALLOWED_TRANSITIONS[fromState];
  assert.ok(Array.isArray(allowed), `ALLOWED_TRANSITIONS for ${fromState} must be an array`);

  for (const toState of allowed) {
    assert.equal(
      canTransitionPane(fromState, toState),
      true,
      `canTransitionPane(${fromState}, ${toState}) must return true`,
    );

    const state = createMockPaneState(fromState);
    assert.doesNotThrow(
      () => transitionPane(state, toState),
      `transitionPane(${fromState} -> ${toState}) must not throw`,
    );
    assert.equal(state.status, toState);
  }
}

// Specific illegal transitions that must fail
const illegalPairs: [GranularPaneStatus, GranularPaneStatus][] = [
  ["completed", "blocked"],
  ["dead", "working"],
  ["dead", "waiting-user"],
  ["dead", "blocked"],
  ["blocked", "review"],
  ["starting", "completed"],
  ["starting", "review"],
  ["completed", "starting"],
];

for (const [fromState, toState] of illegalPairs) {
  assert.equal(
    canTransitionPane(fromState, toState),
    false,
    `canTransitionPane(${fromState}, ${toState}) must be false`,
  );

  const state = createMockPaneState(fromState);
  assert.throws(
    () => transitionPane(state, toState),
    /Invalid PaneState transition/,
    `transitionPane(${fromState} -> ${toState}) must throw Invalid PaneState transition`,
  );
}
console.log("  ✓ ALLOWED_TRANSITIONS matrix enforcement validated (legal & illegal transitions)");

// =========================================================================
// 3. Transition Side Effects & Guards
// =========================================================================
console.log("  3. Verifying transition side effects & guards...");
const s3 = createMockPaneState("working");
const prevUpdate = s3.atualizadoEm!;

// Transition to blocked with reason
transitionPane(s3, "blocked", { reason: "Cota de tokens esgotada" });
assert.equal(s3.status, "blocked");
assert.equal(s3.blockedReason, "Cota de tokens esgotada");
assert.ok(s3.atualizadoEm! >= prevUpdate);

// Transition out of blocked clears blockedReason
transitionPane(s3, "working");
assert.equal(s3.status, "working");
assert.equal(s3.blockedReason, null, "blockedReason must be cleared when exiting blocked state");

// Transition to failed records exit code
transitionPane(s3, "failed", { exitCode: 137 });
assert.equal(s3.status, "failed");
assert.equal(s3.exitCode, 137);

// Transition from failed to starting (restart)
transitionPane(s3, "starting");
assert.equal(s3.status, "starting");

// Self-transition updates metadata
transitionPane(s3, "starting", { exitCode: 0 });
assert.equal(s3.exitCode, 0);
console.log("  ✓ Transition side effects (blockedReason, exitCode, atualizadoEm) verified");

// =========================================================================
// 4. Active State Detection & Status Labels
// =========================================================================
console.log("  4. Verifying isPaneActive and getPaneStatusLabel...");
assert.equal(isPaneActive("starting"), true);
assert.equal(isPaneActive("waiting-user"), true);
assert.equal(isPaneActive("working"), true);
assert.equal(isPaneActive("blocked"), true);
assert.equal(isPaneActive("review"), true);
assert.equal(isPaneActive("completed"), true);
assert.equal(isPaneActive("run"), true);
assert.equal(isPaneActive("idle"), true);
assert.equal(isPaneActive("failed"), false);
assert.equal(isPaneActive("dead"), false);

const expectedLabels: Record<GranularPaneStatus, string> = {
  starting: "Inicializando",
  "waiting-user": "Aguardando Usuário",
  working: "Em Atividade",
  blocked: "Bloqueado",
  review: "Em Revisão",
  completed: "Concluído",
  failed: "Falha",
  dead: "Encerrado",
};

for (const [status, expectedLabel] of Object.entries(expectedLabels)) {
  assert.equal(
    getPaneStatusLabel(status as GranularPaneStatus),
    expectedLabel,
    `Status label for ${status} must be ${expectedLabel}`,
  );
}
assert.equal(getPaneStatusLabel("run"), "Em Atividade");
assert.equal(getPaneStatusLabel("idle"), "Aguardando Usuário");
console.log("  ✓ isPaneActive and localized getPaneStatusLabel verified");

// =========================================================================
// 5. PaneActivityTracker Metrics & Autonomous Transitions
// =========================================================================
console.log("  5. Verifying PaneActivityTracker metrics & autonomous transitions...");
const tracker = new PaneActivityTracker("pane-test-tracker", DEFAULT_SPARKLINE_SLOTS, DEFAULT_IDLE_TIMEOUT_MS);
const state5 = createMockPaneState("starting");

// Record input
tracker.recordInput(64, state5);
assert.equal(tracker.bytesIn, 64);
assert.equal(state5.bytesIn, 64);

// Record output while starting -> auto-transitions to working
tracker.recordOutput(128, state5);
assert.equal(tracker.bytesOut, 128);
assert.equal(state5.bytesOut, 128);
assert.equal(state5.status, "working", "Output in 'starting' state must auto-transition to 'working'");

// Sparkline tick
const tick1 = tracker.tick(state5);
assert.equal(tick1.atividade.length, DEFAULT_SPARKLINE_SLOTS);
assert.equal(tick1.atividade[DEFAULT_SPARKLINE_SLOTS - 1], 128, "Last slot must contain accumulated bytes");
assert.equal(tracker.acumulado, 0, "Accumulated bytes must reset after tick");

// Idle timeout transition
// Simulate 2500ms since last output
const simulatedNow = tracker.lastData + 2500;
const tickIdle = tracker.tick(state5, simulatedNow);
assert.equal(state5.status, "waiting-user", "Idle timeout must transition 'working' -> 'waiting-user'");
assert.equal(tickIdle.status, "waiting-user");
assert.equal(tickIdle.changed, true);

// Active output while waiting-user -> transitions back to working
tracker.recordOutput(256, state5);
assert.equal(state5.status, "working", "Active output must transition 'waiting-user' -> 'working'");

// Clean shutdown transition: working -> dead
transitionPane(state5, "dead", { exitCode: 0 });
assert.equal(state5.status, "dead");
assert.equal(isPaneActive(state5.status), false);

console.log("  ✓ PaneActivityTracker byte metrics, sparkline sliding, and idle transitions verified");

console.log("  6. Verifying ANSI/keepalive output does not count as work...");
const ansiTracker = new PaneActivityTracker("pane-ansi", DEFAULT_SPARKLINE_SLOTS, DEFAULT_IDLE_TIMEOUT_MS);
const ansiState = createMockPaneState("waiting-user");
ansiTracker.recordOutput("\x1b[>4;2m\x1b[?25l\x1b[0m", ansiState);
assert.equal(ansiState.status, "waiting-user", "CSI keepalive must not mark pane working");
assert.equal(ansiState.bytesOut > 0, true, "raw bytes still counted");
const leftover = createMockPaneState("waiting-user");
const leftoverTracker = new PaneActivityTracker("pane-da", DEFAULT_SPARKLINE_SLOTS, DEFAULT_IDLE_TIMEOUT_MS);
leftoverTracker.recordOutput(">4;2m", leftover);
assert.equal(leftover.status, "waiting-user", "DA leftover without ESC must not mark pane working");
ansiTracker.recordOutput("Pronto no prompt\n", ansiState);
assert.equal(ansiState.status, "working", "Visible agent text must mark pane working");
console.log("  ✓ ANSI/keepalive ignored; visible text still counts as work");

console.log("All check-pane-states.ts checks PASSED successfully!");
process.exit(0);
