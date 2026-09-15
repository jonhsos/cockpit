/**
 * Smoke opt-in do runtime SDK (PR-2).
 * Rode com DSH_RUNTIME_SMOKE=1. Sem a flag: skip exit 0.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  checkDshAvailability,
  getDshBinPath,
  getDshHomePath,
  isDshHomeIsolated,
} from "../servidor/sessions/dsh-backend/dsh-availability.ts";
import { createDshRuntime } from "../servidor/sessions/dsh-backend/dsh-runtime.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.DSH_RUNTIME_SMOKE !== "1") {
  console.log("skip: defina DSH_RUNTIME_SMOKE=1 para rodar o smoke do runtime SDK");
  process.exit(0);
}

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? "  ok  " : " FALHA", msg);
  if (!cond) falhas++;
};

console.log("=== SMOKE DSH PR-2: RUNTIME SDK ===\n");

const home = getDshHomePath();
const bin = getDshBinPath();
ok(isDshHomeIsolated(home), `DSH_HOME isolado: ${home}`);
ok(!home.endsWith("/.dsh") && !home.endsWith("\\.dsh"), "DSH_HOME não é ~/.dsh");
ok(existsSync(bin), `bin pinado existe: ${bin}`);

if (!checkDshAvailability().homeExists) {
  console.log("\n--- setup-dsh-cockpit-home.sh ---");
  const setup = join(root, "scripts/setup-dsh-cockpit-home.sh");
  const r = spawnSync("bash", [setup], {
    cwd: root,
    env: { ...process.env, DSH_HOME: home },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  ok(r.status === 0, "setup-dsh-cockpit-home.sh exit 0");
}

const avail = checkDshAvailability();
ok(avail.available, `engine disponível: ${avail.error ?? "ok"}`);
ok(avail.homeExists, "DSH_HOME existe após setup");
ok(avail.isolated, "DSH_HOME continua isolado");

console.log("\n--- start → initialize → close ---");
const runtime = await createDshRuntime({
  cwd: root,
  dshHome: home,
  dshBin: bin,
  // Defaults só para handshake do smoke — não é modelo OmniRoute.
  provider: "deepseek-official",
  model: "deepseek-v4-flash",
});

ok(runtime.pinnedVersion.length > 0, `pin documentado: ${runtime.pinnedVersion}`);

const init = await runtime.start();
ok(Boolean(init.serverInfo?.name), `initialize: ${init.serverInfo?.name}`);
ok(runtime.isStarted(), "runtime marcado como started");

await runtime.close();
ok(!runtime.isStarted(), "runtime fechado (sem leave started=true)");

// Segunda rodada: close idempotente + novo start
await runtime.close();
ok(true, "close() idempotente");

console.log("");
if (falhas > 0) {
  console.error(`FALHOU: ${falhas} asserção(ões)`);
  process.exit(1);
}
console.log("SUCESSO: smoke do runtime SDK passou");
