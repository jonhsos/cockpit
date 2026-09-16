import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appDataDirDoAgy, materializarPerfilAgy } from "../servidor/providers/agy.ts";

const raiz = mkdtempSync(join(tmpdir(), "cockpit-agy-profile-"));

try {
  console.log("Verificando espelho do token Agy no app data dir...");

  const tokenRaiz = join(raiz, "antigravity-oauth-token");
  const settingsRaiz = join(raiz, "settings.json");
  writeFileSync(tokenRaiz, '{"auth_method":"consumer"}\n', { mode: 0o600 });
  writeFileSync(settingsRaiz, '{"model":"Gemini 3.8 Flash (High)"}\n', { mode: 0o600 });

  materializarPerfilAgy(raiz);

  const appData = appDataDirDoAgy(raiz);
  const tokenApp = join(appData, "antigravity-oauth-token");
  const settingsApp = join(appData, "settings.json");
  assert.equal(existsSync(tokenApp), true, "token copiado para $HOME/.gemini/antigravity-cli/");
  assert.equal(existsSync(settingsApp), true, "settings.json copiado para o app data dir");
  assert.equal(readFileSync(tokenApp, "utf8"), readFileSync(tokenRaiz, "utf8"));
  assert.equal(readFileSync(settingsApp, "utf8"), readFileSync(settingsRaiz, "utf8"));

  writeFileSync(tokenApp, '{"auth_method":"consumer","refreshed":true}\n');
  materializarPerfilAgy(raiz);
  assert.equal(
    readFileSync(tokenApp, "utf8").includes("refreshed"),
    true,
    "não sobrescreve token já presente no app data dir",
  );

  materializarPerfilAgy(undefined);
  materializarPerfilAgy("");

  const vazio = mkdtempSync(join(tmpdir(), "cockpit-agy-empty-"));
  materializarPerfilAgy(vazio);
  assert.equal(existsSync(join(appDataDirDoAgy(vazio), "antigravity-oauth-token")), false);
  rmSync(vazio, { recursive: true, force: true });

  console.log("PASS: check-agy-profile.ts — token do Ajustes chega no caminho que o CLI lê.");
} finally {
  rmSync(raiz, { recursive: true, force: true });
}
