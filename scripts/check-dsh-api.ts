import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TEST_SECRET_VALUES } from "./security-test-values.mjs";

const root = mkdtempSync(join(tmpdir(), "cockpit-dsh-api-"));
const configPath = join(root, "cockpit.json");
const apiKey = TEST_SECRET_VALUES.deepseekApiKey;
const source = JSON.parse(readFileSync("cockpit.json", "utf8"));
writeFileSync(configPath, JSON.stringify(source, null, 2));
process.env.COCKPIT_CONFIG = configPath;
process.env.COCKPIT_HOME = root;

try {
  const {
    atualizarDshApiModelos,
    descobrirDshApiModelos,
    salvarDshApi,
    listarDshApis,
    envDaDshApi,
  } = await import("../servidor/providers/dsh-api.ts");
  const { createPaneDshRuntimeConfig } = await import("../servidor/sessions/dsh-backend/dsh-pane-config.ts");

  const saved = salvarDshApi({
    id: "deepseek",
    label: "DeepSeek API",
    provider: "deepseek-official",
    model: "deepseek-flash",
    chave: apiKey,
  });
  assert.equal(saved.pronto, true);
  assert.equal(saved.provider, "deepseek-official");
  assert.equal(envDaDshApi("deepseek")[saved.chaveEnv], apiKey);
  assert.ok(!readFileSync(configPath, "utf8").includes(apiKey), "a chave não pode ir para cockpit.json");
  assert.equal(statSync(join(root, "chaves.json")).mode & 0o777, 0o600, "o cofre deve ser legível somente pelo usuário");
  assert.equal(statSync(join(root, "chave-mestra")).mode & 0o777, 0o600, "a chave mestra deve ser legível somente pelo usuário");
  assert.equal(statSync(root).mode & 0o777, 0o700, "a pasta do cofre deve ser acessível somente pelo usuário");

  const route = listarDshApis().find((item) => item.id === "deepseek");
  assert.equal(route?.model, "deepseek-flash");
  assert.equal(route?.api, null, "rota oficial não deve inventar protocolo");
  const nativeCatalog = await atualizarDshApiModelos("deepseek");
  assert.deepEqual(nativeCatalog.modelos.map(({ id }) => id), [
    "deepseek-flash",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek-v4-flash-vision-exp",
  ]);

  const runtime = createPaneDshRuntimeConfig({
    cli: "deepseek",
    model: "deepseek-flash",
    autoAprovar: true,
    sandbox: "workspace-write",
  });
  assert.ok(runtime);
  assert.equal(runtime.provider, "deepseek-official");
  assert.equal(runtime.credentialEnv, saved.chaveEnv);
  const patch = readFileSync(runtime.patchPath, "utf8");
  assert.match(patch, /id: llm-deepseek/);
  assert.match(patch, /deepseek-flash/);
  assert.ok(!patch.includes(apiKey), "a chave não pode aparecer no patch Cordis");
  rmSync(dirname(runtime.patchPath), { recursive: true, force: true });

  assert.throws(
    () => salvarDshApi({ id: "unsafe", label: "Unsafe", provider: "unsafe", model: "x", chave: "x", api: "openai-responses", baseURL: "http://api.example.com" }),
    /HTTPS/,
  );
  assert.throws(
    () => salvarDshApi({ id: "incomplete", label: "Incomplete", provider: "incomplete", model: "x", chave: "x", api: "openai-responses" }),
    /protocolo e a URL/,
  );

  const server = createServer((request, response) => {
    if (request.url === "/v1/models" && request.headers.authorization === `Bearer ${apiKey}`) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [
        { id: "gateway-fast", name: "Gateway Fast", context_window: 128000 },
        { id: "gateway-reasoning", name: "Gateway Reasoning", max_output_tokens: 16000 },
      ] }));
      return;
    }
    response.statusCode = 401;
    response.end("unauthorized");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseURL = `http://127.0.0.1:${address.port}/v1`;
    const draft = await descobrirDshApiModelos({
      provider: "custom-gateway",
      api: "openai-completions",
      baseURL,
      chave: apiKey,
    });
    assert.deepEqual(draft.map(({ id }) => id), ["gateway-fast", "gateway-reasoning"]);

    salvarDshApi({
      id: "custom-gateway",
      label: "Gateway de teste",
      provider: "custom-gateway",
      model: "gateway-fast",
      chave: apiKey,
      api: "openai-completions",
      baseURL,
      modelos: draft,
    });
    const savedGateway = await atualizarDshApiModelos("custom-gateway");
    assert.deepEqual(savedGateway.modelos.map(({ id }) => id), ["gateway-fast", "gateway-reasoning"]);
    assert.deepEqual(listarDshApis().find((item) => item.id === "custom-gateway")?.modelos.map(({ id }) => id), ["gateway-fast", "gateway-reasoning"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  console.log("PASS: API direta DSH salva a chave no cofre e gera rota nativa DeepSeek sem depender de OmniRoute.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
