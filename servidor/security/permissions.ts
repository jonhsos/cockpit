import { resolve, relative, dirname, basename } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import type { PermissionMode } from "./types.ts";

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export interface SandboxFlags {
  args: string[];
  permissionMode: PermissionMode;
  dangerOptIn: boolean;
}

function isRestrictedGitPath(relativePosixPath: string): boolean {
  const normalized = relativePosixPath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const gitIdx = segments.indexOf(".git");
  if (gitIdx !== -1) {
    const sub = segments.slice(gitIdx + 1).join("/");
    if (sub.startsWith("hooks") || sub === "hooks" || sub.startsWith("config") || sub === "config") {
      return true;
    }
  }
  return false;
}

/**
 * Validates that targetPath does not escape workspaceRoot via traversal or symlink.
 * Throws PermissionError if outside workspace or accessing restricted intra-workspace dirs.
 */
export function assertWithinWorkspace(targetPath: string, workspaceRoot: string): string {
  const absRoot = resolve(workspaceRoot);
  const absTarget = resolve(absRoot, targetPath || ".");

  const rel = relative(absRoot, absTarget);
  if (rel.startsWith("..") || (rel !== "" && resolve(absRoot, rel) !== absTarget)) {
    throw new PermissionError(`Caminho fora do workspace permitido: ${targetPath}`);
  }

  // Check for restricted intra-workspace system paths (e.g. .git/hooks, .git/config)
  if (isRestrictedGitPath(rel)) {
    throw new PermissionError(
      `Acesso a diretório restrito do repositório (${rel.replace(/\\/g, "/")}) proibido`
    );
  }

  // Check if target or any existing ancestor is a symlink pointing outside workspace
  if (existsSync(absTarget)) {
    try {
      const real = realpathSync(absTarget);
      const realRel = relative(absRoot, real);
      if (realRel.startsWith("..") || (realRel !== "" && resolve(absRoot, realRel) !== real)) {
        throw new PermissionError(
          `Symlink aponta para fora do workspace: ${targetPath} -> ${real}`
        );
      }
      if (isRestrictedGitPath(realRel)) {
        throw new PermissionError(
          `Acesso a diretório restrito do repositório (${realRel.replace(/\\/g, "/")}) proibido`
        );
      }
    } catch (err: any) {
      if (err instanceof PermissionError) throw err;
      // Best effort if stat fails
    }
  } else {
    // Non-existent target: verify parent realpath to prevent traversal via symlinked directories
    let curr = dirname(absTarget);
    const uncreatedSegments: string[] = [basename(absTarget)];
    while (curr && !existsSync(curr) && curr !== dirname(curr)) {
      uncreatedSegments.unshift(basename(curr));
      curr = dirname(curr);
    }

    if (existsSync(curr)) {
      try {
        const realParent = realpathSync(curr);
        const realParentRel = relative(absRoot, realParent);
        if (realParentRel.startsWith("..") || (realParentRel !== "" && resolve(absRoot, realParentRel) !== realParent)) {
          throw new PermissionError(
            `Symlink de diretório aponta para fora do workspace: ${targetPath} -> ${realParent}`
          );
        }

        const simulatedReal = resolve(realParent, ...uncreatedSegments);
        const realRel = relative(absRoot, simulatedReal);
        if (realRel.startsWith("..") || (realRel !== "" && resolve(absRoot, realRel) !== simulatedReal)) {
          throw new PermissionError(
            `Symlink de diretório aponta para fora do workspace: ${targetPath} -> ${simulatedReal}`
          );
        }

        if (isRestrictedGitPath(realParentRel) || isRestrictedGitPath(realRel)) {
          throw new PermissionError(
            `Acesso a diretório restrito do repositório (${realRel.replace(/\\/g, "/")}) proibido`
          );
        }
      } catch (err: any) {
        if (err instanceof PermissionError) throw err;
      }
    }
  }

  return absTarget;
}

/**
 * Resolves safe CLI flags for runners according to mission permission mode.
 * In workspace-write mode: prevents --dangerously-skip-permissions and -y.
 */
export function resolveSandboxFlags(
  cli: string,
  requestedMode?: PermissionMode,
  hasExplicitConfirmation?: boolean
): SandboxFlags {
  const isDangerGranted =
    requestedMode === "danger-full-access" && hasExplicitConfirmation === true;

  const permissionMode: PermissionMode = isDangerGranted
    ? "danger-full-access"
    : "workspace-write";

  const dangerOptIn = permissionMode === "danger-full-access";
  const args: string[] = [];

  const lowerCli = cli.toLowerCase();

  if (lowerCli === "codex") {
    if (permissionMode === "workspace-write") {
      args.push("--sandbox", "workspace-write");
    } else {
      args.push("--sandbox", "danger-full-access");
    }
  } else if (lowerCli === "claude" || lowerCli === "agy") {
    if (dangerOptIn) {
      args.push("--dangerously-skip-permissions");
    }
  }

  return {
    args,
    permissionMode,
    dangerOptIn,
  };
}

/**
 * Prohibits piping arbitrary agent text into bash stdin (R1 & R11).
 */
export function validateStdinWrite(
  paneRunner: string,
  inputSource: "human" | "agent" | "mailbox"
): void {
  if (paneRunner.toLowerCase() === "bash" && inputSource === "agent") {
    throw new PermissionError(
      "Proibido injetar texto arbitrário de agente diretamente no stdin do bash"
    );
  }
}
