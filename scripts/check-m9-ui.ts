// Verificação do Marco M9: Experiência do Usuário Plug-and-Play no Cockpit
// (Frontend Config.tsx, WebSocket onboarding:step, Túnel Reverso & Onboarding 1-Clique)
// Uso: node scripts/check-m9-ui.ts

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import * as net from "node:net";
import { createAccountPoolsRouter } from "../servidor/routes/account-pools-router.ts";
import { accountPool } from "../servidor/providers/account-pool.ts";
import { AgyOnboardingService, AGY_OAUTH_CONFIG } from "../servidor/providers/agy-onboarding.ts";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? "  ok  " : " FALHA", msg);
  if (!cond) falhas++;
};

function checkPortClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port });
    sock.on("connect", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => resolve(true));
  });
}

async function main() {
  console.log("=== MARCO M9: VERIFICAÇÃO DA INTERFACE PLUG-AND-PLAY & ONBOARDING ===\n");

  // --- 1. Inspeção de Código Estático do Frontend ---
  console.log("--- 1. Inspeção Estática do Frontend (Contratos, UI e Usabilidade) ---");

  const configContent = readFileSync(resolve("web/Config.tsx"), "utf8");
  const socketContent = readFileSync(resolve("web/socket.ts"), "utf8");
  const apiContent = readFileSync(resolve("web/api.ts"), "utf8");
  const cssContent = readFileSync(resolve("web/style.css"), "utf8");

  // 1.1 Eliminação de campos técnicos para usuário comum
  ok(
    !configContent.includes('placeholder="JETSKI_APP_DATA_DIR"') &&
    !configContent.includes('placeholder="CODEX_HOME"'),
    "Campos técnicos de variáveis de ambiente (JETSKI_APP_DATA_DIR / CODEX_HOME) eliminados dos formulários comuns"
  );
  ok(
    !configContent.includes('placeholder="Caminho do diretório (ex: ~/.codex-acc5)"') &&
    !configContent.includes('placeholder="ID único (ex: codex-5, agy-5)"'),
    "Inputs de ID único e caminhos manuais de diretório removidos da UI comum"
  );

  // 1.2 Botão de 1 clique para login Google
  ok(
    configContent.includes("+ Adicionar conta ao pool (Login Google)"),
    "Botão de 1-clique '+ Adicionar conta ao pool (Login Google)' presente para o agy"
  );

  // 1.3 Card de Onboarding e túnel reverso
  ok(
    configContent.includes("onboard-card") &&
    configContent.includes("onboardSessions") &&
    configContent.includes("Túnel Reverso: 127.0.0.1:"),
    "Card de onboarding plug-and-play com exibição em tempo real do Túnel Reverso (127.0.0.1)"
  );

  // 1.4 Suporte a fallback manual para ambientes VPS / headless
  ok(
    configContent.includes("onboard-manual-toggle") &&
    configContent.includes("enviarCallbackManual"),
    "Fallback manual para ambientes VPS/headless com captura de URL/código presente no componente"
  );

  // 1.5 WebSocket and API typing
  ok(
    socketContent.includes('type: "onboarding:step"') &&
    socketContent.includes('step: "waiting" | "configuring" | "success" | "error"'),
    "Tipo de evento WebSocket 'onboarding:step' declarado com estados canônicos em web/socket.ts"
  );
  ok(
    apiContent.includes("startOnboarding") &&
    apiContent.includes("getOnboardingStatus") &&
    apiContent.includes("cancelOnboarding") &&
    apiContent.includes("submitManualOnboardingCallback"),
    "Funções tipadas de onboarding exportadas em web/api.ts"
  );

  // 1.6 Estilos no tema escuro do Cockpit
  ok(
    cssContent.includes(".onboard-card") &&
    cssContent.includes(".onboard-pulse") &&
    cssContent.includes(".onboard-status"),
    "Estilos e animações (.onboard-card, .onboard-pulse, .onboard-status) presentes em web/style.css"
  );

  // --- 2. Verificação de Ciclo de Vida da API e Eventos em Tempo Real ---
  console.log("\n--- 2. Verificação Funcional da API e Eventos em Tempo Real ---");

  const broadcastEvents: any[] = [];
  const fakeCtx: any = {
    broadcast: (ev: any) => broadcastEvents.push(ev),
    notifyMaestro: () => {},
    limits: new Map(),
  };

  const app = express();
  app.use(express.json());
  app.use("/api", createAccountPoolsRouter(fakeCtx));

  const server = createServer(app);
  const testPort = await new Promise<number>((res) => {
    server.listen(0, "127.0.0.1", () => {
      res((server.address() as any).port);
    });
  });

  const origTokenUrl = AGY_OAUTH_CONFIG.tokenUrl;
  const origUserInfoUrl = AGY_OAUTH_CONFIG.userInfoUrl;

  // Servidor OAuth Mock
  const mockOAuthApp = express();
  mockOAuthApp.use(express.urlencoded({ extended: true }));
  mockOAuthApp.use(express.json());
  mockOAuthApp.post("/token", (_req, res) => {
    res.json({
      access_token: "mock-ui-access-token",
      refresh_token: "mock-ui-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
  });
  mockOAuthApp.get("/userinfo", (_req, res) => {
    res.json({ email: "ui.plugandplay@teste.com" });
  });

  const mockServer = createServer(mockOAuthApp);
  const mockOAuthPort = await new Promise<number>((res) => {
    mockServer.listen(0, "127.0.0.1", () => {
      res((mockServer.address() as any).port);
    });
  });

  AGY_OAUTH_CONFIG.tokenUrl = `http://127.0.0.1:${mockOAuthPort}/token`;
  AGY_OAUTH_CONFIG.userInfoUrl = `http://127.0.0.1:${mockOAuthPort}/userinfo`;

  let createdAccountId = "";
  let loopbackPort = 0;

  try {
    // 2.1 Iniciar sessão via POST /api/account-pools/onboard
    const startRes = await fetch(`http://127.0.0.1:${testPort}/api/account-pools/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cli: "agy" }),
    });
    const startData = await startRes.json();
    ok(startRes.status === 200 && startData.ok === true, "POST /api/account-pools/onboard inicia com HTTP 200");
    ok(Boolean(startData.sessionId && startData.authUrl), "sessionId e authUrl gerados corretamente");
    loopbackPort = startData.loopbackPort;
    ok(loopbackPort > 0, `Servidor loopback ouvindo em porta efêmera: ${loopbackPort}`);

    // 2.2 Consultar status inicial via GET
    const statusRes = await fetch(`http://127.0.0.1:${testPort}/api/account-pools/onboard/${startData.sessionId}`);
    const statusData = await statusRes.json();
    ok(statusRes.status === 200 && statusData.status === "waiting", "GET /onboard/:sessionId retorna status 'waiting'");

    // 2.3 Simular autorização e finalização via callback manual
    broadcastEvents.length = 0;
    const cbRes = await fetch(`http://127.0.0.1:${testPort}/api/account-pools/onboard/${startData.sessionId}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "valid_ui_test_code" }),
    });
    const cbData = await cbRes.json();
    ok(cbRes.status === 200 && cbData.ok === true, "POST /callback processa código e retorna HTTP 200");
    ok(cbData.account?.label === "ui.plugandplay@teste.com", `Conta provisionada com email: ${cbData.account?.label}`);
    createdAccountId = cbData.account?.id;

    // 2.4 Verificar encerramento do loopback
    await new Promise((r) => setTimeout(r, 100));
    ok(await checkPortClosed(loopbackPort), `Porta loopback ${loopbackPort} fechada após sucesso (zero vazamento de portas)`);

    // 2.5 Verificar emissão de eventos WebSocket para a UI
    const temStepSuccess = broadcastEvents.some(
      (ev) => ev.type === "onboarding:step" && ev.step === "success" && ev.sessionId === startData.sessionId
    );
    const temPoolUpdated = broadcastEvents.some((ev) => ev.type === "pool:updated");
    ok(temStepSuccess, "Evento WebSocket 'onboarding:step' (success) emitido para atualizar a UI");
    ok(temPoolUpdated, "Evento WebSocket 'pool:updated' emitido para atualizar badges e lista de contas");

    // 2.6 Teste de cancelamento de sessão
    const startRes2 = await fetch(`http://127.0.0.1:${testPort}/api/account-pools/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cli: "agy" }),
    });
    const startData2 = await startRes2.json();
    const cancelRes = await fetch(`http://127.0.0.1:${testPort}/api/account-pools/onboard/${startData2.sessionId}`, {
      method: "DELETE",
    });
    ok(cancelRes.status === 200, "DELETE /onboard/:sessionId cancela sessão voluntariamente");
    await new Promise((r) => setTimeout(r, 100));
    ok(await checkPortClosed(startData2.loopbackPort), "Loopback cancelado fechou porta imediatamente");

  } finally {
    AGY_OAUTH_CONFIG.tokenUrl = origTokenUrl;
    AGY_OAUTH_CONFIG.userInfoUrl = origUserInfoUrl;
    server.close();
    mockServer.close();
    AgyOnboardingService.resetAllSessions();

    // Limpar conta de teste criada
    if (createdAccountId) {
      accountPool.removeAccount("agy", createdAccountId);
    }
  }

  console.log("\n===============================================================================");
  if (falhas > 0) {
    console.error(`FALHA: ${falhas} verificações falharam no Marco M9.`);
    process.exit(1);
  } else {
    console.log("PASS: 100% das verificações do Marco M9 foram aprovadas com sucesso!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Erro fatal na verificação do Marco M9:", err);
  process.exit(1);
});
