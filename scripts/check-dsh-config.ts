import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  config,
  backendDo,
  resolveCliBackend,
  parseCliBackend,
  isCliBackend,
  CLI_BACKENDS,
  type CliSpec,
} from "../servidor/config.ts";
import {
  checkDshAvailability,
  getDshBinPath,
  getDshHomePath,
  isDshHomeIsolated,
  PINNED_DSH_VERSION,
  DEFAULT_DSH_REPO_PATH,
} from "../servidor/sessions/dsh-backend/dsh-availability.ts";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? "  ok  " : " FALHA", msg);
  if (!cond) falhas++;
};

console.log("=== VERIFICAÇÃO DSH PR-1: CONFIG, BACKEND E DISPONIBILIDADE ===\n");

// ----------------------------------------------------------------------------
// 1. Default PTY e integridade do cockpit.json
// ----------------------------------------------------------------------------
console.log("--- 1. Default PTY quando backend é omitido ---");

ok(config.clis.claude !== undefined, "CLI 'claude' está presente no config");
ok(config.clis.codex !== undefined, "CLI 'codex' está presente no config");
ok(config.clis.agy !== undefined, "CLI 'agy' está presente no config");

// No PR-1, cockpit.json permanece PTY implícito (backend não definido no JSON)
ok(config.clis.claude.backend === undefined, "cockpit.json: claude.backend é omitido (pty implícito)");
ok(config.clis.codex.backend === undefined, "cockpit.json: codex.backend é omitido (pty implícito)");
ok(config.clis.agy.backend === undefined, "cockpit.json: agy.backend é omitido (pty implícito)");

// backendDo / resolveCliBackend retornam "pty" para CLIs sem backend explícito
ok(backendDo("claude") === "pty", "backendDo('claude') retorna 'pty' por default");
ok(backendDo("codex") === "pty", "backendDo('codex') retorna 'pty' por default");
ok(backendDo("agy") === "pty", "backendDo('agy') retorna 'pty' por default");
ok(backendDo("inexistente") === "pty", "backendDo('inexistente') retorna 'pty'");

const specSemBackend: CliSpec = { command: "custom-cli" };
ok(backendDo(specSemBackend) === "pty", "backendDo(CliSpec sem backend) retorna 'pty'");
ok(resolveCliBackend(specSemBackend) === "pty", "resolveCliBackend(CliSpec sem backend) retorna 'pty'");
ok(backendDo(undefined) === "pty", "backendDo(undefined) retorna 'pty'");
ok(backendDo(null) === "pty", "backendDo(null) retorna 'pty'");

// ----------------------------------------------------------------------------
// 2. Parse de backend válido
// ----------------------------------------------------------------------------
console.log("\n--- 2. Parse e reconhecimento de backends válidos ---");

ok(parseCliBackend(undefined) === "pty", "parseCliBackend(undefined) -> 'pty'");
ok(parseCliBackend(null) === "pty", "parseCliBackend(null) -> 'pty'");
ok(parseCliBackend("pty") === "pty", "parseCliBackend('pty') -> 'pty'");
ok(parseCliBackend("dsh") === "dsh", "parseCliBackend('dsh') -> 'dsh'");

ok(isCliBackend("pty") === true, "isCliBackend('pty') é true");
ok(isCliBackend("dsh") === true, "isCliBackend('dsh') é true");
ok(isCliBackend("docker") === false, "isCliBackend('docker') é false");
ok(isCliBackend(123) === false, "isCliBackend(123) é false");
ok(isCliBackend(null) === false, "isCliBackend(null) é false");

const specPty: CliSpec = { command: "test", backend: "pty" };
const specDsh: CliSpec = { command: "test", backend: "dsh" };
ok(backendDo(specPty) === "pty", "backendDo respeita backend explícito 'pty'");
ok(backendDo(specDsh) === "dsh", "backendDo respeita backend explícito 'dsh'");
ok(resolveCliBackend(specDsh) === "dsh", "resolveCliBackend respeita backend explícito 'dsh'");

// ----------------------------------------------------------------------------
// 3. Recusa de valor inválido
// ----------------------------------------------------------------------------
console.log("\n--- 3. Recusa de valores inválidos de backend ---");

const valoresInvalidos = ["docker", "sdk", "acp", "bash", "PTY", "DSH", "", 123, true, {}];
for (const val of valoresInvalidos) {
  let lancou = false;
  try {
    parseCliBackend(val);
  } catch (err: unknown) {
    lancou = true;
    const msg = err instanceof Error ? err.message : String(err);
    ok(msg.includes("Valor inválido para backend de CLI"), `Erro informativo para '${String(val)}': ${msg}`);
  }
  ok(lancou, `parseCliBackend(${JSON.stringify(val)}) lança erro`);
}

// ----------------------------------------------------------------------------
// 4. Detecção de engine DSH e disponibilidade
// ----------------------------------------------------------------------------
console.log("\n--- 4. Detecção de engine DSH e isolamento de DSH_HOME ---");

const defaultBin = getDshBinPath();
const defaultHome = getDshHomePath();

ok(defaultBin.endsWith("apps/cli/lib/bin.js"), `Binário padrão aponta para checkout local: ${defaultBin}`);
ok(defaultHome.endsWith("dsh-home"), `DSH_HOME padrão aponta para subpasta isolada: ${defaultHome}`);

// Isolamento: não compartilhar ~/.dsh do dsh web
const webDshHome = join(homedir(), ".dsh");
ok(isDshHomeIsolated(webDshHome) === false, "~/.dsh do dsh web é REJEITADO como não isolado");
ok(isDshHomeIsolated(defaultHome) === true, `${defaultHome} é aceito como DSH_HOME isolado`);
ok(isDshHomeIsolated("/tmp/custom-dsh-isolated") === true, "Pasta arbitrária fora de ~/.dsh é aceita como isolada");

// Cenário A: ausência de binário
const detAusenciaBin = checkDshAvailability({
  binPath: "/caminho/totalmente/inexistente/bin.js",
  homePath: tmpdir(),
});
ok(detAusenciaBin.available === false, "Ausência de binário: available = false");
ok(detAusenciaBin.binExists === false, "Ausência de binário: binExists = false");
ok(typeof detAusenciaBin.error === "string" && detAusenciaBin.error.includes("Binário DSH não encontrado"), "Erro relata binário ausente");

// Cenário B: DSH_HOME não isolado (~/.dsh)
const detNaoIsolado = checkDshAvailability({
  binPath: defaultBin,
  homePath: webDshHome,
});
ok(detNaoIsolado.available === false, "DSH_HOME apontando para ~/.dsh: available = false");
ok(detNaoIsolado.isolated === false, "DSH_HOME apontando para ~/.dsh: isolated = false");
ok(typeof detNaoIsolado.error === "string" && detNaoIsolado.error.includes("DSH_HOME não pode ser ~/.dsh"), "Erro relata que DSH_HOME não pode ser ~/.dsh");

// Cenário C: ausência de DSH_HOME (pasta não existe)
const detAusenciaHome = checkDshAvailability({
  binPath: defaultBin,
  homePath: "/caminho/inexistente/pasta-dsh-home-test-12345",
});
ok(detAusenciaHome.available === false, "Ausência de DSH_HOME: available = false");
ok(detAusenciaHome.homeExists === false, "Ausência de DSH_HOME: homeExists = false");
ok(detAusenciaHome.isolated === true, "Caminho isolado mas inexistente tem isolated = true");
ok(typeof detAusenciaHome.error === "string" && detAusenciaHome.error.includes("Diretório isolado DSH_HOME não encontrado"), "Erro relata pasta DSH_HOME ausente");

// Cenário D: Disponibilidade completa quando bin pinado e home isolado existem
const tempIsolatedHome = mkdtempSync(join(tmpdir(), "cockpit-dsh-test-"));
try {
  const detCompleto = checkDshAvailability({
    binPath: defaultBin,
    homePath: tempIsolatedHome,
  });
  ok(detCompleto.binExists === true, `Binário pinado do checkout local encontrado em: ${defaultBin}`);
  ok(detCompleto.homeExists === true, "Diretório isolado de teste existe");
  ok(detCompleto.isolated === true, "Diretório isolado de teste é isolado");
  ok(detCompleto.available === true, "Com binário pinado + DSH_HOME isolado: available = true");
  ok(detCompleto.version === PINNED_DSH_VERSION, `Versão pinada detectada: ${detCompleto.version} (esperado: ${PINNED_DSH_VERSION})`);
} finally {
  rmSync(tempIsolatedHome, { recursive: true, force: true });
}

// ----------------------------------------------------------------------------
// 5. Estado real atual do sistema (pré-PR2)
// ----------------------------------------------------------------------------
console.log("\n--- 5. Estado real do sistema (pré-PR2) ---");
const realStatus = checkDshAvailability();
ok(realStatus.binExists === true, "Checkout local do DSH contém binário funcional");
ok(realStatus.isolated === true, "Caminho configurado para DSH_HOME é isolado");
ok(realStatus.homeExists === false, "DSH_HOME real (~/.cockpit/dsh-home) ainda não existe (será provisionado no PR-2)");
ok(realStatus.available === false, "Estado atual honesto: engine reporta indisponível até o PR-2 configurar o home");
ok(typeof realStatus.error === "string", `Mensagem descritiva do estado atual: ${realStatus.error}`);

// ----------------------------------------------------------------------------
// Resumo
// ----------------------------------------------------------------------------
console.log("\n=================================================");
if (falhas > 0) {
  console.error(`FALHA: ${falhas} teste(s) falharam.`);
  process.exit(1);
} else {
  console.log("SUCESSO: Todos os testes do PR-1 (config + detecção DSH) passaram!");
  process.exit(0);
}
