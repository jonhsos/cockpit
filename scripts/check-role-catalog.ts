import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { CATALOG_ROLES, PRIMARY_ROLES } from "../web/tipos.ts";
import { promptInternoDoPapel, roleContractFor } from "../servidor/orchestration/roles.ts";

const expected = [
  ["maestro", "Orquestrador", ["Orquestrador", "Planejador"]],
  ["scout", "Explorador", ["Explorador", "Pesquisador"]],
  ["architect", "Arquiteto", ["Arquiteto", "Planejador"]],
  ["builder", "Construtor", ["Construtor / Executor", "Integrador"]],
  ["debugger", "Depurador", ["Depurador", "Especialista"]],
  ["reviewer", "Revisor", ["Revisor", "Revisor de Segurança"]],
  ["verifier", "Verificador", ["Verificador", "Testador", "Auditor"]],
  ["finalizer", "Finalizador", ["Finalizador", "Documentador"]],
] as const;

assert.equal(PRIMARY_ROLES.length, expected.length, "o catálogo deve ter oito posições principais");
for (const [id, label, functions] of expected) {
  const role = PRIMARY_ROLES.find((item) => item.id === id);
  assert.ok(role, `papel principal ausente: ${id}`);
  assert.equal(role.label, label, `nome visível incorreto para ${id}`);
  for (const functionName of functions) {
    assert.ok(role.incorporates?.includes(functionName), `${label} deve incorporar ${functionName}`);
  }
}

assert.ok(CATALOG_ROLES.some((role) => role.id === "luna"), "especialização de UX deve continuar disponível");
assert.ok(CATALOG_ROLES.some((role) => role.id === "artista"), "especialização de mídia deve continuar disponível");

for (const [id, label] of expected) {
  const contract = roleContractFor(id);
  assert.equal(contract.label, label, `contrato backend incorreto para ${id}`);
  const prompt = promptInternoDoPapel({ role: id, objetivo: "objetivo de teste", tarefa: "tarefa de teste" });
  assert.match(prompt, new RegExp(`IDENTIDADE: Você atua oficialmente como ${label}\\.`));
  assert.match(prompt, /CAPACIDADES INCORPORADAS:/);
  assert.match(prompt, /CONTRATO INTERNO DO PAPEL/);
}

const catalogSource = readFileSync("web/RoleCatalog.tsx", "utf8");
const missionSource = readFileSync("web/NovaMissao.tsx", "utf8");
assert.match(catalogSource, /8 posições principais/);
assert.match(catalogSource, /Funções incorporadas/);
assert.match(catalogSource, /CATALOG_ROLES/);
assert.match(missionSource, /8 posições principais/);
assert.match(missionSource, /Abrange:/);
assert.match(missionSource, /CATALOG_ROLES/);

console.log("PASS: catálogo com oito posições em português e contratos sincronizados.");
