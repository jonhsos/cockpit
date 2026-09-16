import assert from "node:assert/strict";
import { identidadeVisualDoPapel, roleContractFor } from "../servidor/orchestration/roles.ts";
import { corDoPainel, nomeDoPainel, sementeDoPainel } from "../web/rotulos.ts";
import type { AgentSpec, PaneState } from "../web/api.ts";

const agents: Record<string, AgentSpec> = {
  builder: { label: "CONSTRUTOR", cor: "#4fb286", cli: "claude" },
  scout: { label: "EXPLORADOR", cor: "#4a9fd8", cli: "claude" },
};

function pane(partial: Partial<PaneState> & Pick<PaneState, "paneId" | "agent">): PaneState {
  return {
    label: agents[partial.agent]?.label ?? partial.agent,
    cor: agents[partial.agent]?.cor ?? "#94a3b8",
    cli: "claude",
    model: null,
    effort: null,
    tipo: null,
    cwd: "/tmp",
    projectId: "p1",
    missionId: "m1",
    sessionId: null,
    maestro: false,
    status: "waiting-user",
    bytesIn: 0,
    bytesOut: 0,
    iniciadoEm: 0,
    atividade: [],
    ...partial,
  };
}

console.log("Verificando identidade visual de Arquiteto vs Construtor...");

const architectVisual = identidadeVisualDoPapel("architect");
const builderVisual = identidadeVisualDoPapel("builder");
assert.ok(architectVisual, "papel architect tem identidade");
assert.ok(builderVisual, "papel builder tem identidade");
assert.equal(architectVisual.label, "ARQUITETO");
assert.equal(builderVisual.label, "CONSTRUTOR");
assert.notEqual(architectVisual.cor, builderVisual.cor, "Arquiteto e Construtor não compartilham a mesma cor");
assert.equal(identidadeVisualDoPapel("arquiteto")?.label, "ARQUITETO");
assert.equal(identidadeVisualDoPapel(undefined), undefined);
assert.equal(roleContractFor("architect").label, "Arquiteto");
assert.equal(roleContractFor("builder").label, "Construtor");

const construtor = pane({ paneId: "p-builder", agent: "builder", role: "builder" });
const arquiteto = pane({
  paneId: "p-arch",
  agent: "builder",
  role: "architect",
  label: "CONSTRUTOR",
  cor: "#4fb286",
});
const irmaos = [construtor, arquiteto];

assert.equal(nomeDoPainel(construtor, irmaos, agents), "CONSTRUTOR");
assert.equal(nomeDoPainel(arquiteto, irmaos, agents), "ARQUITETO");
assert.equal(sementeDoPainel(arquiteto), "architect");
assert.equal(sementeDoPainel(construtor), "builder");
assert.notEqual(sementeDoPainel(arquiteto), sementeDoPainel(construtor));
assert.equal(corDoPainel(arquiteto), architectVisual.cor);
assert.equal(corDoPainel(construtor), builderVisual.cor);

const arquitetoNovo = pane({
  paneId: "p-arch-2",
  agent: "builder",
  role: "architect",
  label: "ARQUITETO",
  cor: architectVisual.cor,
});
assert.equal(nomeDoPainel(arquitetoNovo, [arquitetoNovo], agents), "ARQUITETO");

const apelido = pane({
  paneId: "p-nick",
  agent: "builder",
  role: "architect",
  label: "desenho-auth",
});
assert.equal(nomeDoPainel(apelido, [apelido], agents), "desenho-auth");

const doisArquitetos = [
  pane({ paneId: "a1", agent: "builder", role: "architect", label: "ARQUITETO" }),
  pane({ paneId: "a2", agent: "builder", role: "architect", label: "ARQUITETO" }),
];
assert.equal(nomeDoPainel(doisArquitetos[0]!, doisArquitetos, agents), "ARQUITETO · 1");
assert.equal(nomeDoPainel(doisArquitetos[1]!, doisArquitetos, agents), "ARQUITETO · 2");

const mistura = [
  pane({ paneId: "c1", agent: "builder", role: "builder", label: "CONSTRUTOR" }),
  pane({ paneId: "d1", agent: "builder", role: "debugger", label: "CONSTRUTOR" }),
  pane({ paneId: "v1", agent: "builder", role: "verifier", label: "CONSTRUTOR" }),
  pane({ paneId: "a3", agent: "builder", role: "architect", label: "CONSTRUTOR" }),
  pane({ paneId: "d2", agent: "builder", role: "debugger", label: "CONSTRUTOR" }),
];
assert.equal(nomeDoPainel(mistura[0]!, mistura, agents), "CONSTRUTOR");
assert.equal(nomeDoPainel(mistura[1]!, mistura, agents), "DEPURADOR · 1");
assert.equal(nomeDoPainel(mistura[2]!, mistura, agents), "VERIFICADOR");
assert.equal(nomeDoPainel(mistura[3]!, mistura, agents), "ARQUITETO");
assert.equal(nomeDoPainel(mistura[4]!, mistura, agents), "DEPURADOR · 2");
assert.equal(identidadeVisualDoPapel("debugger")?.label, "DEPURADOR");
assert.equal(identidadeVisualDoPapel("verifier")?.label, "VERIFICADOR");

console.log("PASS: check-role-identity.ts — Arquiteto não herda identidade do Construtor.");
