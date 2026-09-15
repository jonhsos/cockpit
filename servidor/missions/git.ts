import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";

const run = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout.trim();
}

export function pastaWorktrees(root: string): string {
  return resolve(root, "..", ".cockpit-worktrees");
}

/** Um worktree só nasce de um HEAD real: repo sem commit não gera branch. */
export async function temCommit(root: string): Promise<boolean> {
  return git(["rev-parse", "HEAD"], root).then(
    () => true,
    () => false,
  );
}

/**
 * Prepara a pasta para isolamento por missão: inicia o git e faz o primeiro
 * commit. Só roda quando você pede — nunca por conta própria.
 */
export async function prepararGit(root: string): Promise<void> {
  await git(["init"], root).catch(() => {});
  if (await temCommit(root)) return;
  await git(["add", "-A"], root);
  await git(
    ["-c", "user.email=cockpit@local", "-c", "user.name=cockpit", "commit", "-m", "início"],
    root,
  ).catch(() => {
    throw new Error("não consegui fazer o primeiro commit — a pasta está vazia?");
  });
}

export async function addWorktree(
  root: string,
  projetoSlug: string,
  missaoSlug: string,
): Promise<{ worktree: string; branch: string }> {
  const worktree = join(pastaWorktrees(root), projetoSlug, missaoSlug);
  const branch = `cockpit/${missaoSlug}`;
  await git(["worktree", "add", worktree, "-b", branch], root);
  return { worktree, branch };
}

export async function removeWorktree(
  root: string,
  worktree: string,
  branch: string,
): Promise<void> {
  await git(["worktree", "remove", "--force", worktree], root).catch(() => {});
  await git(["worktree", "prune"], root).catch(() => {});
  await git(["branch", "-D", branch], root).catch(() => {});
}

export async function branchStatus(
  pasta: string,
): Promise<{ dirty: number; head: string | null }> {
  const [status, head] = await Promise.all([
    git(["status", "--porcelain"], pasta).catch(() => ""),
    git(["rev-parse", "--short", "HEAD"], pasta).catch(() => null),
  ]);
  return { dirty: status ? status.split("\n").length : 0, head };
}
