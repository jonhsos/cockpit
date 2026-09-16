import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sandbox = mkdtempSync(join(tmpdir(), "cockpit-pasta-real-"));
const cockpitHome = join(sandbox, "home");
const projectRoot = join(sandbox, "projeto");
mkdirSync(projectRoot, { recursive: true });
process.env.COCKPIT_HOME = cockpitHome;

execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
writeFileSync(join(projectRoot, "README.md"), "# projeto\n");
execFileSync("git", ["add", "README.md"], { cwd: projectRoot });
execFileSync(
  "git",
  ["-c", "user.email=cockpit@local", "-c", "user.name=cockpit", "commit", "-m", "inicio"],
  { cwd: projectRoot, stdio: "ignore" },
);

const state = await import("../servidor/state.ts");
const missions = await import("../servidor/missions/missions.ts");

const project = state.addProject(projectRoot);
const mission = await missions.createMission(project.id, "pasta real", "editar o projeto real");

assert.equal(mission.worktree, realpathSync(projectRoot));
assert.equal(mission.branch, null);
assert.equal(mission.isolada, false);
assert.equal(missions.cwdDaMissao(mission), realpathSync(projectRoot));
assert.equal(existsSync(join(sandbox, ".cockpit-worktrees")), false);

const link = join(sandbox, "atalho-projeto");
symlinkSync(projectRoot, link, "dir");
assert.equal(state.addProject(link).id, project.id, "links para a mesma pasta não duplicam projeto");

const blocked = join(sandbox, ".cockpit-worktrees", "projeto", "missao");
mkdirSync(blocked, { recursive: true });
assert.throws(
  () => state.addProject(blocked),
  /pasta real do projeto/,
  "worktrees do Cockpit não podem ser abertos como projeto",
);

const legacyDir = join(sandbox, "worktree-legado");
mkdirSync(legacyDir);
writeFileSync(join(legacyDir, "nao-apagar.txt"), "preservado\n");
const legacy = state.addMission({
  projectId: project.id,
  nome: "legado",
  objetivo: "preservar dados",
  worktree: legacyDir,
  branch: "cockpit/legado",
  isolada: true,
});
await missions.archiveMission(legacy.id, async () => {});
assert.equal(existsSync(join(legacyDir, "nao-apagar.txt")), true, "arquivar não apaga worktree legado");

console.log("SUCESSO: missões novas usam a pasta real e worktrees legados são preservados.");
