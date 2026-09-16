/**
 * Testes de validação para suporte interativo a agentes DSH,
 * diagnóstico e fluxo de login de contas do pool, e alternância DSH vs PTY.
 */
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contaAutenticada, accountPool } from "../servidor/providers/account-pool.ts";
import { config, backendDo, parseCliBackend } from "../servidor/config.ts";
import { DshManager, MAX_DSH_PROMPT_LENGTH } from "../servidor/sessions/dsh-backend/dsh-manager.ts";
import { type PaneState } from "../servidor/sessions/pane-state.ts";
import { submitPrompt } from "../servidor/pty.ts";
import { TerminalHandler } from "../servidor/websocket/terminal-handler.ts";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? "  ok  " : " FALHA", msg);
  if (!cond) falhas++;
};

console.log("=== CHECK DSH INTERATIVE, AUTH DIAGNOSTICS & BACKEND SWITCHING ===\n");

// ----------------------------------------------------------------------------
// 1. R1: Entrada Interativa de Prompts e Ciclo de Sessão DSH
// ----------------------------------------------------------------------------
console.log("--- 1. R1: Entrada Interativa de Prompts no DSH Manager ---");

type MockNotification = { method: string; params: Record<string, unknown> };
const notifications: MockNotification[] = [];
const notificationWaiters: Array<(notification: MockNotification) => void> = [];
const pushNotification = (notification: MockNotification) => {
  const waiter = notificationWaiters.shift();
  if (waiter) waiter(notification);
  else notifications.push(notification);
};
const nextNotification = () => {
  const notification = notifications.shift();
  if (notification) return Promise.resolve(notification);
  return new Promise<MockNotification>((resolve) => notificationWaiters.push(resolve));
};

const promptLog: string[] = [];
let capturedOutput = "";
let messageCounter = 0;
let failNextPrompt = false;
const mockClient = {
  prompt: async (sessionId: string, blocks: Array<{ type: "text"; text: string }>) => {
    const text = blocks[0]?.text ?? "";
    promptLog.push(text);
    if (failNextPrompt) {
      failNextPrompt = false;
      throw new Error("falha simulada");
    }
    const messageId = `message-${++messageCounter}`;
    setTimeout(() => {
      pushNotification({
        method: "session.event",
        params: {
          sessionId,
          event: { type: "agent/inbox/spliced", data: { inserted: [{ id: messageId }] } },
        },
      });
      pushNotification({
        method: "session.event",
        params: {
          sessionId,
          event: {
            type: "assistant/message",
            data: { message: { role: "assistant", content: [{ type: "text", text: `resposta:${text}` }] } },
          },
        },
      });
      pushNotification({ method: "session.status", params: { sessionId, status: "idle" } });
    }, 25);
    return messageId;
  },
  subscribe: () => ({ next: nextNotification, close: () => {} }),
};
const mockRuntime = {
  pinnedVersion: "test",
  dshBin: "/tmp/dsh-test",
  dshHome: "/tmp/dsh-home-test",
  isStarted: () => true,
  start: async () => ({ serverInfo: { name: "dsh-test", version: "test" } }),
  getClient: () => mockClient,
  close: async () => {},
};
const dshManager = new DshManager(async () => mockRuntime as any);
ok(typeof dshManager.submitPrompt === "function", "DshManager expõe submitPrompt");

// Test submitPrompt on non-existent pane returns false
const nonExistentResult = await dshManager.submitPrompt("pane-nao-existe", "olá mundo");
ok(nonExistentResult === false, "submitPrompt em pane inexistente retorna false de forma graciosa");

const testPaneId = "test-dsh-interactive-" + Date.now();
const mockState: PaneState = {
  paneId: testPaneId,
  agent: "codex",
  label: "Codex Interactive Test",
  backend: "dsh",
  status: "waiting-user",
  bytesIn: 0,
  bytesOut: 0,
  iniciadoEm: Date.now(),
  atualizadoEm: Date.now(),
  saidaRecente: "",
};
await dshManager.spawn({
  paneId: testPaneId,
  state: mockState,
  cwd: process.cwd(),
  onOutput: (data) => { capturedOutput += data; },
});

// Test submitPrompt rejects empty or whitespace-only prompts
const emptyResult = await dshManager.submitPrompt(testPaneId, "   ");
ok(emptyResult === false, "submitPrompt com texto em branco retorna false");

const submitSuccess = await dshManager.submitPrompt(testPaneId, "ajuste o layout do header");
ok(submitSuccess === true, "submitPrompt em sessão ativa retorna true");

// Give microtasks time to execute promptQueue
await new Promise((r) => setTimeout(r, 60));

ok(promptLog.includes("ajuste o layout do header"), "Prompt foi entregue ao cliente DSH");
ok(capturedOutput.includes("> ajuste o layout do header"), "Prompt foi ecoado com prefixo > no transcript");
ok(mockState.status === "waiting-user", "Status retornou para waiting-user após conclusão da resposta");

// Test multiline prompt formatting without xterm staircasing
capturedOutput = "";
const multilineSuccess = await dshManager.submitPrompt(testPaneId, "primeira linha\nsegunda linha");
ok(multilineSuccess === true, "submitPrompt aceita prompt multilinha");
await new Promise((r) => setTimeout(r, 60));
ok(capturedOutput.includes("> primeira linha\r\n> segunda linha"), "Prompt multilinha é formatado com prefixo > por linha e \\r\\n para evitar escada no xterm");

// Test sequential prompt queuing against acceptance-immediate SDK semantics
const beforeSequential = promptLog.length;
await Promise.all([
  dshManager.submitPrompt(testPaneId, "primeiro comando"),
  dshManager.submitPrompt(testPaneId, "segundo comando"),
]);
await new Promise((r) => setTimeout(r, 10));
ok(promptLog.length === beforeSequential + 1, "Segundo prompt aguarda session.status=idle do primeiro turno");
await new Promise((r) => setTimeout(r, 70));
ok(
  promptLog.slice(beforeSequential).join("|") === "primeiro comando|segundo comando",
  "Prompts consecutivos foram executados em ordem sequencial",
);
ok(mockState.status === "waiting-user", "Status final é waiting-user após fila de prompts");

// Rejection must not poison the queue tail
failNextPrompt = true;
await dshManager.submitPrompt(testPaneId, "prompt que falha");
await dshManager.submitPrompt(testPaneId, "prompt depois da falha");
await new Promise((r) => setTimeout(r, 70));
ok(promptLog.includes("prompt depois da falha"), "Rejeição anterior não trava prompts seguintes");

let oversizedRejected = false;
try {
  await dshManager.submitPrompt(testPaneId, "x".repeat(MAX_DSH_PROMPT_LENGTH + 1));
} catch {
  oversizedRejected = true;
}
ok(oversizedRejected, "Prompt acima do limite é rejeitado antes de entrar na fila");

// Adversarial: Verify bytesIn and bytesOut are not double-counted
const prevBytesIn = mockState.bytesIn;
dshManager.write(testPaneId, "teste-bytes-in");
ok(mockState.bytesIn === prevBytesIn, "dshManager.write não duplica contagem de bytesIn gerenciada pelo ptyManager");

// Test transcript capping on large outputs
pushNotification({
  method: "session.event",
  params: {
    sessionId: testPaneId,
    event: {
      type: "assistant/message",
      data: { message: { role: "assistant", content: [{ type: "text", text: "A".repeat(600 * 1024) }] } },
    },
  },
});
await new Promise((r) => setTimeout(r, 10));
ok(dshManager.getTranscript(testPaneId).length <= 512 * 1024, "Transcript do DshManager é limitado a 512KB para evitar vazamento de memória");

await dshManager.kill(testPaneId);

// Test pty.submitPrompt handles non-existent pane gracefully
const nonExistentPtyPrompt = await submitPrompt("non-existent-pane-id", "prompt text");
ok(nonExistentPtyPrompt === false, "pty.submitPrompt em pane inexistente retorna false");

// Test TerminalHandler handles prompt and input safely
const mockContinuity = { record: () => {} } as any;
const mockClientManager = {} as any;
const terminalHandler = new TerminalHandler(mockClientManager, mockContinuity);
ok(typeof terminalHandler.handlePrompt === "function", "TerminalHandler expõe método handlePrompt");
ok(typeof terminalHandler.handleInput === "function", "TerminalHandler expõe método handleInput");

// TerminalHandler.handleInput on missing or invalid input does not throw
terminalHandler.handleInput("pane-id", "");
terminalHandler.handleInput("", "data");
await terminalHandler.handlePrompt("pane-id", "   ");
await terminalHandler.handlePrompt("", "prompt");

// ----------------------------------------------------------------------------
// 2. R2: Diagnóstico e Fluxo de Login de Contas do Pool
// ----------------------------------------------------------------------------
console.log("\n--- 2. R2: Diagnóstico e Detecção de Autenticação de Contas ---");

const tempDir = join(tmpdir(), `cockpit-auth-test-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });

try {
  // Test Codex unauthenticated
  const codexUnauthHome = join(tempDir, "codex-unauth");
  mkdirSync(codexUnauthHome, { recursive: true });
  const isCodexUnauth = contaAutenticada("codex", { CODEX_HOME: codexUnauthHome });
  ok(isCodexUnauth === false, "Codex sem auth.json detectado como NÃO autenticado");

  // Test Codex authenticated
  const codexAuthHome = join(tempDir, "codex-auth");
  mkdirSync(codexAuthHome, { recursive: true });
  writeFileSync(join(codexAuthHome, "auth.json"), JSON.stringify({ token: "test-token" }));
  const isCodexAuth = contaAutenticada("codex", { CODEX_HOME: codexAuthHome });
  ok(isCodexAuth === true, "Codex com auth.json detectado como autenticado");

  // Test Codex authenticated with OPENAI_API_KEY
  const isCodexAuthKey = contaAutenticada("codex", { OPENAI_API_KEY: "sk-proj-test" });
  ok(isCodexAuthKey === true, "Codex com OPENAI_API_KEY detectado como autenticado");

  // Test Claude unauthenticated
  const claudeUnauthConfig = join(tempDir, "claude-unauth");
  mkdirSync(claudeUnauthConfig, { recursive: true });
  const isClaudeUnauth = contaAutenticada("claude", { CLAUDE_CONFIG_DIR: claudeUnauthConfig });
  ok(isClaudeUnauth === false, "Claude sem credenciais detectado como NÃO autenticado");

  // Adversarial: Claude isolated directory must remain unauthenticated even if process.env.ANTHROPIC_API_KEY is present
  const prevEnvKey = process.env.ANTHROPIC_API_KEY;
  try {
    process.env.ANTHROPIC_API_KEY = "sk-ant-global-leak";
    const isClaudeIsolatedUnauth = contaAutenticada("claude", { CLAUDE_CONFIG_DIR: claudeUnauthConfig });
    ok(isClaudeIsolatedUnauth === false, "Claude com perfil isolado vazio não é mascarado por process.env.ANTHROPIC_API_KEY global");
  } finally {
    if (prevEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevEnvKey;
  }

  // Test Claude authenticated with ANTHROPIC_API_KEY
  const isClaudeAuthKey = contaAutenticada("claude", { ANTHROPIC_API_KEY: "sk-ant-api03-test" });
  ok(isClaudeAuthKey === true, "Claude com ANTHROPIC_API_KEY detectado como autenticado");

  // Test Claude authenticated with config directory .credentials.json
  const claudeAuthConfig = join(tempDir, "claude-auth");
  mkdirSync(claudeAuthConfig, { recursive: true });
  writeFileSync(join(claudeAuthConfig, ".credentials.json"), JSON.stringify({ session: "test" }));
  const isClaudeAuthConfig = contaAutenticada("claude", { CLAUDE_CONFIG_DIR: claudeAuthConfig });
  ok(isClaudeAuthConfig === true, "Claude com .credentials.json detectado como autenticado");

  // A config file alone must not be treated as an authentication credential
  const claudeHomeDir = join(tempDir, "claude-home-isolated");
  mkdirSync(claudeHomeDir, { recursive: true });
  writeFileSync(join(claudeHomeDir, ".claude.json"), JSON.stringify({ autoUpdaterStatus: "ok" }));
  const isClaudeHomeAuth = contaAutenticada("claude", { HOME: claudeHomeDir });
  ok(isClaudeHomeAuth === false, "Claude com apenas .claude.json continua NÃO autenticado");

  // Test Claude authenticated via isolated HOME/.credentials.json
  const claudeHomeCredsDir = join(tempDir, "claude-home-creds");
  mkdirSync(claudeHomeCredsDir, { recursive: true });
  writeFileSync(join(claudeHomeCredsDir, ".credentials.json"), JSON.stringify({ token: "test" }));
  const isClaudeHomeCredsAuth = contaAutenticada("claude", { HOME: claudeHomeCredsDir });
  ok(isClaudeHomeCredsAuth === true, "Claude isolado via HOME com .credentials.json detectado como autenticado");

  // Adversarial: contaAutenticada with undefined or null env does not throw
  try {
    const isSafeUndef = contaAutenticada("codex", undefined as any);
    ok(typeof isSafeUndef === "boolean", "contaAutenticada com env undefined não lança erro");
  } catch {
    ok(false, "contaAutenticada com env undefined lançou erro");
  }

  // Test Grok authenticated with XAI_API_KEY and GROK_API_KEY
  const isGrokXaiAuth = contaAutenticada("grok", { XAI_API_KEY: "xai-test-key" });
  ok(isGrokXaiAuth === true, "Grok com XAI_API_KEY detectado como autenticado");
  const isGrokKeyAuth = contaAutenticada("grok", { GROK_API_KEY: "grok-test-key" });
  ok(isGrokKeyAuth === true, "Grok com GROK_API_KEY detectado como autenticado");

} finally {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}

// ----------------------------------------------------------------------------
// 3. R3: Alternância Transparente de Backend (DSH vs PTY)
// ----------------------------------------------------------------------------
console.log("\n--- 3. R3: Alternância Transparente de Backend (DSH vs PTY) ---");

// Test switching Codex backend in config
const origCodexBackend = config.clis.codex.backend;
try {
  config.clis.codex.backend = "pty";
  ok(backendDo("codex") === "pty", "Alternei backend codex para 'pty' no config");

  config.clis.codex.backend = "dsh";
  ok(backendDo("codex") === "dsh", "Alternei backend codex para 'dsh' no config");
} finally {
  config.clis.codex.backend = origCodexBackend;
}

// Test switching Claude backend in config
const origClaudeBackend = config.clis.claude.backend;
try {
  config.clis.claude.backend = "pty";
  ok(backendDo("claude") === "pty", "Alternei backend claude para 'pty' no config");

  config.clis.claude.backend = "dsh";
  ok(backendDo("claude") === "dsh", "Alternei backend claude para 'dsh' no config");
} finally {
  config.clis.claude.backend = origClaudeBackend;
}

// Test PaneState respects explicit backend
const ptyPane: PaneState = {
  paneId: "test-pty-pane",
  agent: "codex",
  label: "Codex PTY",
  backend: "pty",
  status: "idle",
  bytesIn: 0,
  bytesOut: 0,
  iniciadoEm: Date.now(),
  atualizadoEm: Date.now(),
  saidaRecente: "",
};
ok(ptyPane.backend === "pty", "PaneState criado com backend 'pty' preserva backend");

const dshPane: PaneState = {
  paneId: "test-dsh-pane",
  agent: "codex",
  label: "Codex DSH",
  backend: "dsh",
  status: "waiting-user",
  bytesIn: 0,
  bytesOut: 0,
  iniciadoEm: Date.now(),
  atualizadoEm: Date.now(),
  saidaRecente: "",
};
ok(dshPane.backend === "dsh", "PaneState criado com backend 'dsh' preserva backend");

// Test parseCliBackend
ok(parseCliBackend("pty") === "pty", "parseCliBackend('pty') -> 'pty'");
ok(parseCliBackend("dsh") === "dsh", "parseCliBackend('dsh') -> 'dsh'");
ok(parseCliBackend(undefined) === "pty", "parseCliBackend(undefined) -> 'pty'");

// ----------------------------------------------------------------------------
// Resumo
// ----------------------------------------------------------------------------
console.log("\n=================================================");
if (falhas === 0) {
  console.log("SUCESSO: Todos os testes de suporte interativo DSH, login e backend passaram!");
  process.exit(0);
} else {
  console.error(`FALHA: ${falhas} teste(s) falharam.`);
  process.exit(1);
}
