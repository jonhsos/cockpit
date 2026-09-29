import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatarEquipeAberta, regrasDeCanalCockpit, montarEspecialistasDaMissao } from "../servidor/orchestration/elenco-missao.ts";
import { canMaestroDelegate } from "../servidor/orchestration/mission-modes.ts";
import { promptInternoDoPapel } from "../servidor/orchestration/roles.ts";
import {
  AGENTE_AGY_ORQUESTRADOR,
  gravarOverlayCockpitAgy,
  nomeDoAgenteAgy,
} from "../servidor/sessions/agy-cockpit-overlay.ts";

console.log("Verificando elenco aberto e overlay Agy...");

const merged = montarEspecialistasDaMissao(
  [
    { paneId: "p3-orq", label: "ORQUESTRADOR", role: "maestro", cli: "agy", maestro: true, connected: true, status: "waiting-user" },
    { paneId: "p4-scout", label: "EXPLORADOR", role: "scout", agent: "builder", cli: "codex", connected: true, status: "waiting-user", canAcceptTask: true },
    { paneId: "p5-ver", label: "VERIFICADOR", role: "verifier", agent: "builder", cli: "claude", connected: true, status: "waiting-user", canAcceptTask: true },
    { paneId: "p6-dbg", label: "DEPURADOR", role: "debugger", agent: "builder", cli: "codex", connected: true, status: "waiting-user", canAcceptTask: true },
    { paneId: "p-dead", label: "MORTO", role: "reviewer", cli: "claude", connected: false, status: "dead" },
  ],
  [
    { id: "builder", label: "CONSTRUTOR", papel: "Você é o BUILDER.", cli: "claude", permitido: true },
    { id: "scout", label: "EXPLORADOR", papel: "Você é o SCOUT.", cli: "claude", permitido: true },
    { id: "reviewer", label: "REVISOR", papel: "Você é o REVIEWER.", cli: "claude", permitido: true },
  ],
);

const porPapel = Object.fromEntries(merged.map((e) => [e.id, e]));
assert.equal(porPapel.debugger?.aberto, true, "Depurador aberto deve aparecer mesmo sem estar no catálogo");
assert.equal(porPapel.debugger?.paneId, "p6-dbg");
assert.equal(porPapel.debugger?.delegarComo, "debugger");
assert.equal(porPapel.verifier?.aberto, true, "Verificador aberto deve aparecer");
assert.equal(porPapel.scout?.aberto, true);
assert.equal(porPapel.builder?.aberto, false, "Construtor só no catálogo permanece disponível=false");
assert.equal(porPapel.reviewer?.aberto, false, "Revisor morto não conta como janela aberta");
assert.ok(merged.findIndex((e) => e.aberto) < merged.findIndex((e) => !e.aberto), "janelas abertas vêm primeiro");
const soAbertos = merged.filter((e) => e.aberto);
assert.ok(soAbertos.some((e) => e.id === "debugger"));
assert.ok(soAbertos.every((e) => e.aberto));
assert.ok(!soAbertos.some((e) => e.id === "reviewer"), "Dirigido omite catálogo sem janela");

const autorizados = ["maestro", "ORQUESTRADOR", "debugger", "DEPURADOR", "p6-dbg", "scout", "verifier"];
assert.equal(canMaestroDelegate({ mode: "dirigido", targetAgentOrRole: "debugger", authorizedRoles: autorizados }).allowed, true);
assert.equal(canMaestroDelegate({ mode: "dirigido", targetAgentOrRole: "Depurador", authorizedRoles: autorizados }).allowed, true);
assert.equal(canMaestroDelegate({ mode: "dirigido", targetAgentOrRole: "p6-dbg", authorizedRoles: autorizados }).allowed, true);

const canal = regrasDeCanalCockpit({
  maestro: true,
  modo: "dirigido",
  janelas: [{ paneId: "p6-dbg", label: "DEPURADOR", role: "debugger", cli: "codex" }],
});
assert.match(canal, /DEPURADOR/);
assert.match(canal, /delegarComo: debugger/);
assert.match(canal, /NUNCA crie subagentes/);
assert.match(formatarEquipeAberta([]), /nenhuma janela/);

const contrato = promptInternoDoPapel({ role: "maestro", tarefa: "coordenar", modo: "dirigido" });
assert.match(contrato, /jion_verifier/);
assert.match(contrato, /aberto=true/);
assert.match(contrato, /MODO DIRIGIDO/);

const raiz = mkdtempSync(join(tmpdir(), "check-agy-overlay-"));
try {
  const nome = gravarOverlayCockpitAgy(raiz, {
    label: "ORQUESTRADOR",
    papel: "Você é o MAESTRO.",
    maestro: true,
    modo: "dirigido",
    janelas: [
      { paneId: "p6-dbg", label: "DEPURADOR", role: "debugger", cli: "codex" },
      { paneId: "p4-scout", label: "EXPLORADOR", role: "scout", cli: "codex" },
    ],
  });
  assert.equal(nome, AGENTE_AGY_ORQUESTRADOR);
  assert.equal(nomeDoAgenteAgy(true), AGENTE_AGY_ORQUESTRADOR);
  const agente = readFileSync(join(raiz, ".agents", "agents", nome, "agent.md"), "utf8");
  assert.match(agente, /inheritCustomizations: false/);
  assert.match(agente, /inheritMcp: true/);
  assert.match(agente, /DEPURADOR/);
  assert.match(agente, /jion_verifier/);
  const plugin = readFileSync(join(raiz, ".agents", "plugins", "cockpit-orquestracao", "rules", "AGENTS.md"), "utf8");
  assert.match(plugin, /listar_especialistas/);
  assert.match(readFileSync(join(raiz, ".gemini", "antigravity-cli", "plugins", "cockpit-orquestracao", "plugin.json"), "utf8"), /cockpit-orquestracao/);
  assert.match(readFileSync(join(raiz, "GEMINI.md"), "utf8"), /Cockpit/);
} finally {
  rmSync(raiz, { recursive: true, force: true });
}

console.log("PASS: check-elenco-aberto.ts — janelas abertas entram no elenco e o Agy carrega regras Cockpit.");
