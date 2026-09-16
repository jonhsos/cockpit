import { createServer, type Server } from "node:http";
import * as net from "node:net";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import express from "express";
import { AgyOnboardingService, AGY_OAUTH_CONFIG } from "../servidor/providers/agy-onboarding.ts";
import { accountPool } from "../servidor/providers/account-pool.ts";
import { createAccountPoolsRouter } from "../servidor/routes/account-pools-router.ts";
import type { RouterContext } from "../servidor/routes/types.ts";
import { config } from "../servidor/config.ts";
import { TEST_SECRET_VALUES } from "./security-test-values.mjs";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? "  ok  " : " FALHA", msg);
  if (!cond) falhas++;
};

function checkPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });
}

function checkPortClosed(port: number, retries = 10, intervalMs = 50): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;
    const probe = () => {
      const sock = net.createConnection({ host: "127.0.0.1", port });
      sock.on("connect", () => {
        sock.destroy();
        attempts++;
        if (attempts >= retries) {
          resolve(false);
        } else {
          setTimeout(probe, intervalMs);
        }
      });
      sock.on("error", () => {
        resolve(true);
      });
    };
    probe();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log("=== TESTE AUTOMATIZADO: SERVIÇO DE ONBOARDING AGY (LOOPBACK & TÚNEL REVERSO) ===\n");

  // 1. Iniciar Servidor Mock Google OAuth local
  let mockOAuthServer: Server;
  let mockPort = 0;
  let receivedTokenRequest: any = null;

  await new Promise<void>((resolve, reject) => {
    mockOAuthServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${mockPort}`);

      if (url.pathname === "/token" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const params = new URLSearchParams(body);
        receivedTokenRequest = Object.fromEntries(params.entries());

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: TEST_SECRET_VALUES.oauthAccessToken,
            token_type: "Bearer",
            refresh_token: TEST_SECRET_VALUES.oauthRefreshToken,
            expires_in: 3600,
            id_token: TEST_SECRET_VALUES.jwt,
          }),
        );
        return;
      }

      if (url.pathname === "/userinfo") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ email: "onboard.loopback@teste.com" }));
        return;
      }

      res.writeHead(404).end("Not found");
    });

    mockOAuthServer.on("error", reject);
    mockOAuthServer.listen(0, "127.0.0.1", () => {
      const addr = mockOAuthServer.address();
      if (addr && typeof addr === "object") {
        mockPort = addr.port;
      }
      resolve();
    });
  });

  const origTokenUrl = AGY_OAUTH_CONFIG.tokenUrl;
  const origUserInfoUrl = AGY_OAUTH_CONFIG.userInfoUrl;
  AGY_OAUTH_CONFIG.tokenUrl = `http://127.0.0.1:${mockPort}/token`;
  AGY_OAUTH_CONFIG.userInfoUrl = `http://127.0.0.1:${mockPort}/userinfo`;

  const accountsToCleanup: { id: string; profileDir?: string }[] = [];

  try {
    // -------------------------------------------------------------
    // CENÁRIO 1: Início de Sessão e Verificação do Loopback Server
    // -------------------------------------------------------------
    console.log("--- CENÁRIO 1: Início de Sessão & Parâmetros Google OAuth ---");
    const session1 = await AgyOnboardingService.startSession({ cli: "agy" });

    ok(typeof session1.sessionId === "string" && session1.sessionId.startsWith("onboard-agy-"), "sessionId gerado com formato correto");
    ok(session1.port > 0, `Loopback escutando em porta efêmera: ${session1.port}`);
    ok(session1.redirectUri === `http://127.0.0.1:${session1.port}/callback`, "redirect_uri configurada estritamente em 127.0.0.1");

    // Validação da URL do Google OAuth
    const authUrl = new URL(session1.authUrl);
    ok(authUrl.origin === "https://accounts.google.com", "URL aponta para accounts.google.com");
    ok(authUrl.searchParams.get("client_id") === AGY_OAUTH_CONFIG.clientId, "client_id correto na URL");
    ok(authUrl.searchParams.get("response_type") === "code", "response_type=code presente");
    ok(authUrl.searchParams.get("state") === session1.sessionId, "state igual ao sessionId (CSRF)");
    ok(authUrl.searchParams.get("access_type") === "offline", "access_type=offline presente");

    const scopes = authUrl.searchParams.get("scope") || "";
    ok(scopes.includes("cloud-platform"), "Escopo cloud-platform presente");
    ok(scopes.includes("userinfo.email"), "Escopo userinfo.email presente");
    ok(scopes.includes("userinfo.profile"), "Escopo userinfo.profile presente");
    ok(scopes.includes("cclog"), "Escopo cclog presente");
    ok(scopes.includes("experimentsandconfigs"), "Escopo experimentsandconfigs presente");
    ok(!scopes.includes("openid"), "Escopo openid NÃO está presente (evita tela nativeapp)");
    ok(!authUrl.searchParams.has("code_challenge"), "PKCE code_challenge NÃO está presente");

    // Verificação de escuta ativa na porta efêmera 127.0.0.1:<port>
    const isListening = await checkPortOpen(session1.port);
    ok(isListening, `Servidor HTTP loopback está escutando na porta ${session1.port}`);

    // -------------------------------------------------------------
    // CENÁRIO 2: Simulação de Callback HTTP & Encerramento Gracioso
    // -------------------------------------------------------------
    console.log("\n--- CENÁRIO 2: Simulação de Callback HTTP & Fechamento Sem Vazamento ---");
    const callbackUrl = `http://127.0.0.1:${session1.port}/callback?code=mock_code_test_1&state=${session1.sessionId}`;
    const callbackRes = await fetch(callbackUrl);
    ok(callbackRes.status === 200, "Resposta HTTP 200 recebida no /callback");

    const htmlBody = await callbackRes.text();
    ok(htmlBody.includes("Conta autenticada com sucesso!"), "Página HTML de sucesso retornada");

    // Aguarda o encerramento gracioso e a finalização assíncrona
    await sleep(250);

    // Confirma que a porta foi liberada imediatamente (zero vazamento de descritor/socket)
    const portClosed = await checkPortClosed(session1.port);
    ok(portClosed, `Porta ${session1.port} liberada após callback (zero vazamento de sockets)`);

    const sessState = AgyOnboardingService.getSession(session1.sessionId);
    ok(sessState?.status === "success", "Estado da sessão atualizado para 'success'");
    ok(sessState?.account !== undefined, "Objeto account retornado na sessão");

    if (sessState?.account) {
      accountsToCleanup.push(sessState.account);

      ok(sessState.account.label === "onboard.loopback@teste.com", "Email detectado via id_token/userinfo");
      ok(existsSync(sessState.account.profileDir), `Diretório de perfil criado: ${sessState.account.profileDir}`);

      const tokenFile = join(sessState.account.profileDir, "antigravity-oauth-token");
      ok(existsSync(tokenFile), "Arquivo antigravity-oauth-token criado no perfil");
      const tokenNoAppData = join(
        sessState.account.profileDir,
        ".gemini",
        "antigravity-cli",
        "antigravity-oauth-token",
      );
      ok(existsSync(tokenNoAppData), "Token espelhado em $HOME/.gemini/antigravity-cli/ para o CLI");
      const tokenJson = JSON.parse(readFileSync(tokenFile, "utf8"));
      ok(tokenJson.auth_method === "consumer", "auth_method: consumer no token");
      ok(tokenJson.token?.access_token === TEST_SECRET_VALUES.oauthAccessToken, "access_token gravado com fidelidade");
      ok(tokenJson.token?.refresh_token === TEST_SECRET_VALUES.oauthRefreshToken, "refresh_token gravado com fidelidade");

      const settingsFile = join(sessState.account.profileDir, "settings.json");
      ok(existsSync(settingsFile), "Arquivo settings.json criado no perfil");
      const settingsJson = JSON.parse(readFileSync(settingsFile, "utf8"));
      ok(settingsJson.model === "Gemini 3.8 Flash (High)", "settings.json configurado com Gemini 3.8 Flash (High)");

      // Verifica registro no accountPool
      const poolContas = accountPool.getAccounts("agy");
      const foundInPool = poolContas.find((a) => a.id === sessState.account!.id);
      ok(foundInPool !== undefined, `Conta ${sessState.account.id} registrada no accountPool`);
      ok(
        foundInPool?.env.JETSKI_APP_DATA_DIR !== undefined,
        "JETSKI_APP_DATA_DIR presente no ambiente da conta do pool",
      );
      ok(foundInPool?.env.HOME !== undefined, "HOME presente no ambiente da conta do pool");

      // Verifica persistência no cockpit.json
      const configPool = config.clis.agy?.pool ?? [];
      const foundInConfig = configPool.find((c) => c.id === sessState.account!.id);
      ok(foundInConfig !== undefined, `Conta ${sessState.account.id} persistida em config.clis.agy.pool`);
    }

    // -------------------------------------------------------------
    // CENÁRIO 3: Cancelamento via DELETE / cleanupSession
    // -------------------------------------------------------------
    console.log("\n--- CENÁRIO 3: Cancelamento de Sessão & Limpeza do Loopback ---");
    const sessionCancel = await AgyOnboardingService.startSession({ cli: "agy" });
    const cancelPort = sessionCancel.port;
    ok(await checkPortOpen(cancelPort), `Sessão para cancelamento ouvindo na porta ${cancelPort}`);

    AgyOnboardingService.cleanupSession(sessionCancel.sessionId, "cancelled");
    ok(await checkPortClosed(cancelPort), `Porta ${cancelPort} fechada imediatamente após cancelamento`);

    const cancelledSess = AgyOnboardingService.getSession(sessionCancel.sessionId);
    ok(cancelledSess?.status === "cancelled", "Status da sessão alterado para 'cancelled'");

    // -------------------------------------------------------------
    // CENÁRIO 4: Fallback de Callback Manual (Túnel Reverso / VPS)
    // -------------------------------------------------------------
    console.log("\n--- CENÁRIO 4: Fallback de Callback Manual (Túnel Reverso / VPS) ---");
    const sessionManual = await AgyOnboardingService.startSession({ cli: "agy" });
    const manualPort = sessionManual.port;
    ok(await checkPortOpen(manualPort), `Sessão manual ouvindo na porta ${manualPort}`);

    // Simula colagem da URL redirecionada pelo usuário
    const pastedUrl = `http://127.0.0.1:${manualPort}/callback?code=mock_manual_code_42&state=${sessionManual.sessionId}`;
    const manualAccount = await AgyOnboardingService.handleManualCallback(sessionManual.sessionId, pastedUrl);

    ok(manualAccount !== undefined && manualAccount.id.startsWith("agy-"), `Conta criada via callback manual: ${manualAccount.id}`);
    accountsToCleanup.push(manualAccount);

    // O servidor loopback deve ser fechado após a conclusão manual
    ok(await checkPortClosed(manualPort), `Porta ${manualPort} fechada após processamento manual`);

    const manualSess = AgyOnboardingService.getSession(sessionManual.sessionId);
    ok(manualSess?.status === "success", "Status da sessão manual atualizado para 'success'");

    // -------------------------------------------------------------
    // CENÁRIO 5: Integração Completa com Rotas HTTP Express
    // -------------------------------------------------------------
    console.log("\n--- CENÁRIO 5: Rotas REST do Router (/api/account-pools/onboard) ---");
    const app = express();
    app.use(express.json());

    let broadcastMsgs: any[] = [];
    const mockCtx: Partial<RouterContext> = {
      broadcast: (msg: any) => broadcastMsgs.push(msg),
      notifyMaestro: () => {},
      limits: new Map(),
    };

    app.use("/api", createAccountPoolsRouter(mockCtx as RouterContext));

    let expressServer: Server;
    let expressPort = 0;
    await new Promise<void>((resolve, reject) => {
      expressServer = app.listen(0, "127.0.0.1", () => {
        const addr = expressServer.address();
        if (addr && typeof addr === "object") expressPort = addr.port;
        resolve();
      });
      expressServer.on("error", reject);
    });

    try {
      // 5.1 POST /api/account-pools/onboard
      const startRes = await fetch(`http://127.0.0.1:${expressPort}/api/account-pools/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cli: "agy" }),
      });
      ok(startRes.status === 200, "POST /api/account-pools/onboard retornou 200");
      const startData = (await startRes.json()) as any;
      ok(startData.ok === true && typeof startData.sessionId === "string", "Resposta do router contém ok: true e sessionId");
      ok(typeof startData.loopbackPort === "number", "Resposta contém loopbackPort");

      const restSessionId = startData.sessionId;

      // 5.2 GET /api/account-pools/onboard/:sessionId
      const getRes = await fetch(`http://127.0.0.1:${expressPort}/api/account-pools/onboard/${restSessionId}`);
      ok(getRes.status === 200, "GET /api/account-pools/onboard/:sessionId retornou 200");
      const getData = (await getRes.json()) as any;
      ok(getData.status === "waiting", "Status inicial da sessão via GET é 'waiting'");

      // 5.3 POST /api/account-pools/onboard/:sessionId/callback com código avulso
      const cbRes = await fetch(`http://127.0.0.1:${expressPort}/api/account-pools/onboard/${restSessionId}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "mock_router_code_99" }),
      });
      ok(cbRes.status === 200, "POST /api/account-pools/onboard/:sessionId/callback retornou 200");
      const cbData = (await cbRes.json()) as any;
      ok(cbData.ok === true && cbData.account?.id?.startsWith("agy-"), "Conta retornada pelo endpoint de callback");
      if (cbData.account) {
        accountsToCleanup.push(cbData.account);
      }

      // 5.4 GET status final
      const getFinalRes = await fetch(`http://127.0.0.1:${expressPort}/api/account-pools/onboard/${restSessionId}`);
      const getFinalData = (await getFinalRes.json()) as any;
      ok(getFinalData.status === "success", "Status da sessão consultado via GET é 'success'");

      // 5.5 DELETE /api/account-pools/onboard/:sessionId
      const delSession = await AgyOnboardingService.startSession({ cli: "agy" });
      const delRes = await fetch(`http://127.0.0.1:${expressPort}/api/account-pools/onboard/${delSession.sessionId}`, {
        method: "DELETE",
      });
      ok(delRes.status === 200, "DELETE /api/account-pools/onboard/:sessionId retornou 200");
      ok(await checkPortClosed(delSession.port), "Servidor loopback cancelado via rota DELETE fechou porta");

      // 5.6 Broadcasts WebSocket verificados
      const hasStepSuccess = broadcastMsgs.some((m) => m.type === "onboarding:step" && m.step === "success");
      const hasPoolUpdated = broadcastMsgs.some((m) => m.type === "pool:updated");
      ok(hasStepSuccess, "Evento WebSocket 'onboarding:step' (step: 'success') emitido via broadcast");
      ok(hasPoolUpdated, "Evento WebSocket 'pool:updated' emitido via broadcast");
    } finally {
      expressServer!.close();
    }

    // -------------------------------------------------------------
    // CENÁRIO 6: Tratamento de Erros e Proteção CSRF
    // -------------------------------------------------------------
    console.log("\n--- CENÁRIO 6: Tratamento de Erros, Erro Google & CSRF ---");
    const sessionErr = await AgyOnboardingService.startSession({ cli: "agy" });

    // Erro retornado pelo Google (usuário recusou consentimento)
    const googleErrRes = await fetch(
      `http://127.0.0.1:${sessionErr.port}/callback?error=access_denied&error_description=Usuario+recusou+consentimento`,
    );
    ok(googleErrRes.status === 400, "Erro retornado pelo Google resulta em status 400");
    await sleep(100);
    ok(await checkPortClosed(sessionErr.port), "Loopback fechado após erro de consentimento");
    ok(AgyOnboardingService.getSession(sessionErr.sessionId)?.status === "error", "Sessão marcada como 'error'");

    // State mismatch
    const sessionCsrf = await AgyOnboardingService.startSession({ cli: "agy" });
    const csrfRes = await fetch(
      `http://127.0.0.1:${sessionCsrf.port}/callback?code=mock_code&state=wrong_session_id`,
    );
    ok(csrfRes.status === 400, "State mismatch rejeitado com HTTP 400");
    AgyOnboardingService.cleanupSession(sessionCsrf.sessionId);
  } finally {
    // Restaura configurações globais e encerra servidores
    AGY_OAUTH_CONFIG.tokenUrl = origTokenUrl;
    AGY_OAUTH_CONFIG.userInfoUrl = origUserInfoUrl;
    mockOAuthServer!.close();
    AgyOnboardingService.resetAllSessions();

    // Limpeza de contas de teste criadas no cockpit.json e accountPool
    console.log("\n--- LIMPEZA: Removendo Contas e Pastas Temporárias de Teste ---");
    for (const acc of accountsToCleanup) {
      accountPool.removeAccount("agy", acc.id);
      if (acc.profileDir && existsSync(acc.profileDir)) {
        try {
          rmSync(acc.profileDir, { recursive: true, force: true });
        } catch {}
      }
    }
    console.log(`  ok  ${accountsToCleanup.length} contas de teste limpas com sucesso.`);
  }

  console.log("\n===============================================================================");
  if (falhas > 0) {
    console.error(`FALHA: ${falhas} verificações falharam no onboarding loopback.`);
    process.exit(1);
  } else {
    console.log("PASS: 100% das verificações do onboarding loopback foram aprovadas!");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Erro fatal no teste de onboarding:", err);
  process.exit(1);
});
