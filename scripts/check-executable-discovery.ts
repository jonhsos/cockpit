import assert from "node:assert/strict";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { providerDisponivel, esquecerCache, resolverExecutavel } from "../servidor/providers/providers.ts";
import { resolveCli } from "../servidor/sessions/pty-manager.ts";

const originalPath = process.env.PATH ?? "";
const localBin = join(homedir(), ".local", "bin");
const agyPath = join(localBin, "agy");

try {
  try {
    assert.equal(statSync(agyPath).isFile(), true, `${agyPath} não está instalado nesta máquina`);
    accessSync(agyPath, constants.X_OK);
  } catch {
    console.log(`SKIP: ${agyPath} não está disponível nesta máquina.`);
    process.exit(0);
  }

  process.env.PATH = originalPath
    .split(delimiter)
    .filter((entry) => entry !== localBin)
    .join(delimiter);
  esquecerCache();

  const encontrado = resolverExecutavel("agy");
  assert.equal(encontrado, agyPath, "AGY deve ser encontrado no diretório local mesmo fora do PATH");
  assert.equal(providerDisponivel("agy"), true, "AGY deve aparecer como disponível no catálogo");

  const comando = resolveCli("agy", []);
  assert.equal(comando.file, agyPath, "PTY deve iniciar o AGY pelo caminho absoluto resolvido");

  console.log("PASS: descoberta do AGY e resolução do executável PTY funcionam sem ~/.local/bin no PATH.");
} finally {
  process.env.PATH = originalPath;
  esquecerCache();
}
