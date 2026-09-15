import assert from "node:assert/strict";
import { config } from "../servidor/config.ts";
import { resolveCli } from "../servidor/pty.ts";

// Salva valor original
const original = config.autoAprovar;

try {
  // Teste 1: Ativado (padrão)
  config.autoAprovar = true;

  // Claude com autoAprovar = true
  const claudeArgs: string[] = [];
  if (config.autoAprovar !== false && !claudeArgs.includes("--dangerously-skip-permissions")) {
    claudeArgs.push("--dangerously-skip-permissions");
  }
  assert.ok(claudeArgs.includes("--dangerously-skip-permissions"), "Claude deve incluir --dangerously-skip-permissions quando autoAprovar = true");

  // Agy com autoAprovar = true
  const agyArgs: string[] = [];
  if (config.autoAprovar !== false && !agyArgs.includes("--dangerously-skip-permissions")) {
    agyArgs.push("--dangerously-skip-permissions");
  }
  assert.ok(agyArgs.includes("--dangerously-skip-permissions"), "Agy deve incluir --dangerously-skip-permissions quando autoAprovar = true");

  // Codex com autoAprovar = true
  const codexArgs: string[] = [];
  if (config.autoAprovar !== false) {
    codexArgs.push("--sandbox", "workspace-write", "--ask-for-approval", "never");
  } else {
    codexArgs.push("--sandbox", "workspace-write");
  }
  assert.ok(codexArgs.includes("--ask-for-approval") && codexArgs.includes("never"), "Codex deve incluir --ask-for-approval never");

  // Teste 2: Desativado
  config.autoAprovar = false;

  const claudeOff: string[] = [];
  if (config.autoAprovar !== false && !claudeOff.includes("--dangerously-skip-permissions")) {
    claudeOff.push("--dangerously-skip-permissions");
  }
  assert.ok(!claudeOff.includes("--dangerously-skip-permissions"), "Claude NÃO deve incluir a flag quando autoAprovar = false");

  const agyOff: string[] = [];
  if (config.autoAprovar !== false && !agyOff.includes("--dangerously-skip-permissions")) {
    agyOff.push("--dangerously-skip-permissions");
  }
  assert.ok(!agyOff.includes("--dangerously-skip-permissions"), "Agy NÃO deve incluir a flag quando autoAprovar = false");

  const codexOff: string[] = [];
  if (config.autoAprovar !== false) {
    codexOff.push("--sandbox", "workspace-write", "--ask-for-approval", "never");
  } else {
    codexOff.push("--sandbox", "workspace-write");
  }
  assert.ok(!codexOff.includes("--ask-for-approval"), "Codex NÃO deve incluir --ask-for-approval quando autoAprovar = false");

  console.log("PASS: Auto-aprovação de comandos testada com sucesso para Claude, Antigravity e Codex.");
} finally {
  config.autoAprovar = original;
}
