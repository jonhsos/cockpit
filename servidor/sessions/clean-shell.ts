import { existsSync } from "node:fs";

/**
 * Sovereign Clean Shell Implementation (Requirement R1).
 *
 * Mandates:
 * 1. SHELL runner must always spawn strictly as `/bin/bash -i -l`.
 * 2. Zero LLM auto-boot: never auto-start Codex, Claude, Gemini, Agy or any LLM in a shell pane.
 * 3. Zero prompt injection: never pass initial task strings, system prompts, or hidden instructions to bash.
 * 4. Zero stdin injection: never write maestro instructions or background commands into bash stdin.
 * 5. Absolute precedence: explicit selection of `bash` / `shell` overrides roster (elenco), failover,
 *    and execution policies.
 */

export const BASH_PATH = existsSync("/bin/bash") ? "/bin/bash" : "bash";
export const CLEAN_SHELL_ARGS = ["-i", "-l"] as const;

export interface CleanShellOptions {
  porta?: number;
  missionId?: string | null;
  projectId?: string | null;
  paneId: string;
  label?: string;
  cwd?: string;
}

/**
 * Determines whether a given agent, cli, or runner identifier represents a clean bash shell.
 */
export function isCleanShell(
  target:
    | {
        agent?: string;
        cli?: string;
        runner?: string;
        papel?: string;
        role?: string;
        harness?: { invoke?: { cli?: string }; roster?: { cli?: string } };
      }
    | string
    | undefined
    | null,
): boolean {
  if (!target) return false;
  if (typeof target === "string") {
    const norm = target.trim().toLowerCase();
    return norm === "shell" || norm === "bash" || norm === "/bin/bash";
  }
  const agent = (target.agent ?? "").trim().toLowerCase();
  const cli = (target.cli ?? "").trim().toLowerCase();
  const runner = (target.runner ?? "").trim().toLowerCase();
  const papel = (target.papel ?? "").trim().toLowerCase();
  const role = (target.role ?? "").trim().toLowerCase();
  const invokeCli = (target.harness?.invoke?.cli ?? "").trim().toLowerCase();
  const rosterCli = (target.harness?.roster?.cli ?? "").trim().toLowerCase();

  return (
    agent === "shell" ||
    agent === "bash" ||
    cli === "bash" ||
    cli === "/bin/bash" ||
    runner === "bash" ||
    runner === "shell" ||
    papel === "shell" ||
    papel === "bash" ||
    role === "shell" ||
    role === "bash" ||
    invokeCli === "bash" ||
    invokeCli === "/bin/bash" ||
    rosterCli === "bash" ||
    rosterCli === "/bin/bash"
  );
}

/**
 * Returns strictly the sovereign clean shell execution file and arguments: `/bin/bash -i -l`.
 */
export function getCleanShellCommand(): { file: string; args: string[] } {
  return {
    file: BASH_PATH,
    args: [...CLEAN_SHELL_ARGS],
  };
}

/**
 * Produces a pristine environment for clean shell panes.
 * Strips out LLM agent markers, prompt injection variables, and maestro bridges,
 * while preserving standard terminal variables.
 */
export function sanitizeCleanShellEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  opts: CleanShellOptions,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  // Remove Claude Code and AI harness markers that alter child behavior, as well as npm lifecycle variables
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("CLAUDE_CODE_") ||
      key === "CLAUDECODE" ||
      key.startsWith("COCKPIT_MAESTRO_") ||
      key === "COCKPIT_PROMPT" ||
      key === "COCKPIT_TASK" ||
      key === "COCKPIT_INSTRUCTION" ||
      key.toLowerCase().startsWith("npm_")
    ) {
      delete env[key];
    }
  }

  // Ensure standard terminal environment
  env.TERM = "xterm-256color";
  env.SHELL = BASH_PATH;

  // Informative context only (for display / UI correlation)
  if (opts.porta) env.COCKPIT_PORT = String(opts.porta);
  if (opts.missionId) env.COCKPIT_MISSION = opts.missionId;
  if (opts.projectId) env.COCKPIT_PROJECT = opts.projectId;
  env.COCKPIT_PANE = opts.paneId;
  env.COCKPIT_AGENT = opts.label || "Shell";

  return env;
}

/**
 * Enforces R1 invariants before spawning a clean shell:
 * - Must be /bin/bash (or system bash) with strictly ["-i", "-l"].
 * - No prompt injection, hidden flags, or stdin task strings permitted.
 */
export function assertCleanShellInvariants(
  command: { file: string; args: string[] },
  stdinPayload?: string | { tarefa?: string | null; [key: string]: unknown },
): void {
  // 1. Verify executable is bash
  const fileNorm = command.file.replaceAll("\\", "/").toLowerCase();
  if (!fileNorm.endsWith("/bin/bash") && !fileNorm.endsWith("bash") && !fileNorm.endsWith("bash.exe")) {
    throw new Error(
      `R1 Violation: SHELL runner must execute strictly as /bin/bash (received: "${command.file}")`,
    );
  }

  // 2. Verify arguments are strictly ["-i", "-l"]
  const validArgs = command.args.length === 2 && command.args[0] === "-i" && command.args[1] === "-l";
  if (!validArgs) {
    throw new Error(
      `R1 Violation: SHELL runner must be invoked strictly with ["-i", "-l"] (received: ${JSON.stringify(command.args)})`,
    );
  }

  // If stdinPayload is an object containing tarefa, safely discard/ignore it
  if (typeof stdinPayload === "object" && stdinPayload !== null) {
    if ("tarefa" in stdinPayload) {
      return;
    }
  }

  // 3. Prohibit stdin prompt injection
  if (typeof stdinPayload === "string" && stdinPayload.trim().length > 0) {
    throw new Error(
      `R1 Violation: Prompt injection into bash stdin is prohibited. Shell must remain clean and pristine.`,
    );
  }
}

/**
 * Enforces absolute precedence of `bash` over mission rosters, failover policies, and catalog restrictions.
 */
export function enforceBashPrecedence(
  requestedCliOrRunner: string,
  _missionElenco?: string[],
): { allowed: boolean; effectiveCli: string; sovereign: boolean } {
  if (isCleanShell(requestedCliOrRunner)) {
    return {
      allowed: true,
      effectiveCli: "bash",
      sovereign: true,
    };
  }
  return {
    allowed: true,
    effectiveCli: requestedCliOrRunner,
    sovereign: false,
  };
}
