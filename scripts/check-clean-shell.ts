import assert from "node:assert/strict";
import {
  isCleanShell,
  getCleanShellCommand,
  sanitizeCleanShellEnv,
  assertCleanShellInvariants,
  enforceBashPrecedence,
  BASH_PATH,
  CLEAN_SHELL_ARGS,
} from "../servidor/sessions/clean-shell.ts";
import { spawnPane, killPty } from "../servidor/pty.ts";

console.log("Running check-clean-shell.ts (R1 Sovereign Clean Shell Verification)...");

// Test 1: Identify clean shell requests accurately
console.log("  1. Verifying clean shell detection (isCleanShell)...");
assert.equal(isCleanShell("shell"), true);
assert.equal(isCleanShell("bash"), true);
assert.equal(isCleanShell("/bin/bash"), true);
assert.equal(isCleanShell({ agent: "shell" }), true);
assert.equal(isCleanShell({ cli: "bash" }), true);
assert.equal(isCleanShell({ runner: "bash" }), true);
assert.equal(isCleanShell({ papel: "shell" }), true);

assert.equal(isCleanShell("claude"), false);
assert.equal(isCleanShell("codex"), false);
assert.equal(isCleanShell("agy"), false);
assert.equal(isCleanShell({ agent: "builder", cli: "claude" }), false);
assert.equal(isCleanShell({ agent: "astra", cli: "codex" }), false);
console.log("  ✓ Clean shell detection validated");

// Test 2: Strict command invocation /bin/bash -i -l
console.log("  2. Verifying clean shell command structure (/bin/bash -i -l)...");
const cmd = getCleanShellCommand();
assert.equal(cmd.file, BASH_PATH);
assert.deepEqual(cmd.args, ["-i", "-l"]);
console.log(`  ✓ Command is strictly "${cmd.file} ${cmd.args.join(" ")}"`);

// Test 3: Zero LLM auto-boot / pristine environment sanitization
console.log("  3. Verifying environment sanitization (zero LLM auto-boot)...");
const dirtyEnv: NodeJS.ProcessEnv = {
  ...process.env,
  CLAUDE_CODE_ENTRYPOINT: "1",
  CLAUDECODE: "1",
  COCKPIT_MAESTRO_BRIDGE: "/path/to/bridge.ts",
  COCKPIT_TASK: "Do something dangerous",
  COCKPIT_PROMPT: "System prompt injection",
  CODEX_HOME: "/tmp/cockpit-codex-home",
  CLAUDE_CONFIG_DIR: "/tmp/cockpit-claude-home",
  DSH_HOME: "/tmp/cockpit-dsh-home",
  JETSKI_APP_DATA_DIR: "/tmp/cockpit-agy-home",
  GROK_HOME: "/tmp/cockpit-grok-home",
  KIMI_CONFIG_DIR: "/tmp/cockpit-kimi-home",
};
const cleanEnv = sanitizeCleanShellEnv(dirtyEnv, {
  paneId: "test-pane-1",
  label: "Shell",
  porta: 3000,
  missionId: "m-1",
  projectId: "p-1",
});

assert.equal(cleanEnv.CLAUDE_CODE_ENTRYPOINT, undefined);
assert.equal(cleanEnv.CLAUDECODE, undefined);
assert.equal(cleanEnv.COCKPIT_MAESTRO_BRIDGE, undefined);
assert.equal(cleanEnv.COCKPIT_TASK, undefined);
assert.equal(cleanEnv.COCKPIT_PROMPT, undefined);
assert.equal(cleanEnv.CODEX_HOME, undefined);
assert.equal(cleanEnv.CLAUDE_CONFIG_DIR, undefined);
assert.equal(cleanEnv.DSH_HOME, undefined);
assert.equal(cleanEnv.JETSKI_APP_DATA_DIR, undefined);
assert.equal(cleanEnv.GROK_HOME, undefined);
assert.equal(cleanEnv.KIMI_CONFIG_DIR, undefined);
assert.equal(cleanEnv.SHELL, BASH_PATH);
assert.equal(cleanEnv.TERM, "xterm-256color");
assert.equal(cleanEnv.COCKPIT_PANE, "test-pane-1");
assert.equal(cleanEnv.COCKPIT_AGENT, "Shell");
console.log("  ✓ Environment sanitized cleanly (zero LLM markers or prompt variables)");

// Test 4: Zero prompt injection invariant assertions
console.log("  4. Verifying prompt injection and invariant enforcement...");
// Valid case: must pass
assertCleanShellInvariants(cmd, undefined);
assertCleanShellInvariants(cmd, "");

// Invariant violation: prompt text into stdin
assert.throws(
  () => assertCleanShellInvariants(cmd, "echo 'injected prompt'"),
  /R1 Violation: Prompt injection into bash stdin is prohibited/,
);

// Invariant violation: invalid binary
assert.throws(
  () => assertCleanShellInvariants({ file: "/usr/bin/python3", args: ["-i", "-l"] }),
  /R1 Violation: SHELL runner must execute strictly as \/bin\/bash/,
);

// Invariant violation: non-standard args (e.g. -c or prompt flags)
assert.throws(
  () => assertCleanShellInvariants({ file: BASH_PATH, args: ["-c", "whoami"] }),
  /R1 Violation: SHELL runner must be invoked strictly with/,
);
console.log("  ✓ Invariant enforcement prevents prompt injection and non-standard shell flags");

// Test 5: Absolute Precedence of bash over roster and policies
console.log("  5. Verifying absolute bash precedence over roster...");
const roster = ["codex", "claude"];
const result = enforceBashPrecedence("bash", roster);
assert.equal(result.allowed, true);
assert.equal(result.effectiveCli, "bash");
assert.equal(result.sovereign, true);

const shellResult = enforceBashPrecedence("shell", roster);
assert.equal(shellResult.allowed, true);
assert.equal(shellResult.effectiveCli, "bash");
assert.equal(shellResult.sovereign, true);
console.log("  ✓ Bash absolute precedence overrides restrictive roster whitelists");

// Test 6: Spawn Clean Shell Pane via PtyManager
console.log("  6. Verifying live clean shell spawning through PTY Manager...");
const pane = spawnPane({
  agent: "shell",
  cwd: process.cwd(),
  porta: 3000,
  projectId: null,
  missionId: null,
});

assert.ok(pane.paneId.startsWith("p"));
assert.equal(pane.cli, "bash");
assert.equal(pane.runner, "bash");
assert.equal(pane.model, null);
assert.equal(pane.effort, null);
assert.equal(pane.label, "Shell");
assert.ok(pane.status === "starting" || pane.status === "working");

killPty(pane.paneId);
console.log("  ✓ Clean shell pane spawned and verified successfully");

console.log("All clean shell checks PASSED successfully!");
process.exit(0);
