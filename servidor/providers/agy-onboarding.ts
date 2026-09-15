import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { accountPool } from "./account-pool.ts";
import { config, type ContaPoolSpec } from "../config.ts";

/**
 * Credenciais OAuth do Antigravity (installed app).
 * Nunca hardcode no repo: use AGY_OAUTH_CLIENT_ID / AGY_OAUTH_CLIENT_SECRET
 * ou ~/.cockpit/agy-oauth.json ({ "clientId", "clientSecret" }).
 */
function loadOAuthClient(): { clientId: string; clientSecret: string } {
  const fromEnvId = process.env.AGY_OAUTH_CLIENT_ID?.trim() || "";
  const fromEnvSecret = process.env.AGY_OAUTH_CLIENT_SECRET?.trim() || "";
  if (fromEnvId && fromEnvSecret) {
    return { clientId: fromEnvId, clientSecret: fromEnvSecret };
  }

  const localPath = join(homedir(), ".cockpit", "agy-oauth.json");
  if (existsSync(localPath)) {
    try {
      const raw = JSON.parse(readFileSync(localPath, "utf8")) as {
        clientId?: string;
        clientSecret?: string;
      };
      if (raw.clientId?.trim() && raw.clientSecret?.trim()) {
        return { clientId: raw.clientId.trim(), clientSecret: raw.clientSecret.trim() };
      }
    } catch {
      // arquivo ilegível: cai no erro explícito em startSession
    }
  }

  return { clientId: fromEnvId, clientSecret: fromEnvSecret };
}

const oauthClient = loadOAuthClient();

export const AGY_OAUTH_CONFIG = {
  clientId: oauthClient.clientId,
  clientSecret: oauthClient.clientSecret,
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
};

function assertOAuthConfigured(): void {
  if (!AGY_OAUTH_CONFIG.clientId || !AGY_OAUTH_CONFIG.clientSecret) {
    throw new Error(
      "OAuth AGY não configurado. Defina AGY_OAUTH_CLIENT_ID e AGY_OAUTH_CLIENT_SECRET, " +
        'ou grave ~/.cockpit/agy-oauth.json com { "clientId", "clientSecret" }.',
    );
  }
}

export type OnboardingSessionStatus =
  | "waiting"
  | "configuring"
  | "success"
  | "cancelled"
  | "expired"
  | "error";

export interface OnboardingAccountResult {
  id: string;
  label: string;
  profileDir: string;
  env: Record<string, string>;
}

export interface OnboardingSession {
  id: string;
  cli: string;
  port: number;
  server: Server;
  sockets: Set<Socket>;
  redirectUri: string;
  authUrl: string;
  status: OnboardingSessionStatus;
  error?: string;
  account?: OnboardingAccountResult;
  createdAt: number;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

const activeSessions = new Map<string, OnboardingSession>();
const MAX_ACTIVE_SESSIONS = 3;
const TERMINAL_STATUSES: ReadonlySet<OnboardingSessionStatus> = new Set([
  "success",
  "expired",
  "cancelled",
  "error",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderErrorPage(message: string): string {
  const safe = escapeHtml(message);
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Erro de Autenticação — Cockpit</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #dc2626; border-radius: 12px; padding: 32px; text-align: center; max-width: 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h2 { color: #f87171; margin: 0 0 12px; }
    p { color: #94a3b8; margin: 0; word-break: break-word; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Falha na Autorização Google</h2>
    <p>${safe}</p>
  </div>
</body>
</html>`;
}

function renderSuccessPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Cockpit — Autenticação</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px 40px; text-align: center; max-width: 440px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h2 { color: #38bdf8; margin: 0 0 12px; font-size: 20px; font-weight: 600; }
    p { color: #94a3b8; margin: 0; font-size: 14px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Conta autenticada com sucesso!</h2>
    <p>Você pode fechar esta aba e retornar ao Cockpit.</p>
  </div>
</body>
</html>`;
}

export class AgyOnboardingService {
  private static broadcaster: ((msg: unknown) => void) | null = null;
  private static listeners: Set<(event: unknown) => void> = new Set();
  private static allocationChain: Promise<unknown> = Promise.resolve();

  public static setBroadcaster(fn: (msg: unknown) => void): void {
    AgyOnboardingService.broadcaster = fn;
  }

  public static addListener(fn: (event: unknown) => void): () => void {
    AgyOnboardingService.listeners.add(fn);
    return () => {
      AgyOnboardingService.listeners.delete(fn);
    };
  }

  public static broadcast(msg: unknown): void {
    try {
      if (AgyOnboardingService.broadcaster) {
        AgyOnboardingService.broadcaster(msg);
      }
    } catch {}
    for (const listener of AgyOnboardingService.listeners) {
      try {
        listener(msg);
      } catch {}
    }
  }

  private static async withAllocationLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = AgyOnboardingService.allocationChain;
    AgyOnboardingService.allocationChain = prev.then(() => gate);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private static countActiveSessions(): number {
    let n = 0;
    for (const session of activeSessions.values()) {
      if (session.status === "waiting" || session.status === "configuring") n++;
    }
    return n;
  }

  /**
   * Inicia uma sessão de onboarding:
   * Cria servidor HTTP efêmero ouvindo estritamente em 127.0.0.1:0 (suporte a túnel reverso SSH),
   * gera authorization URL Google OAuth e agenda timeout de 5 minutos.
   */
  public static async startSession(options?: {
    preferredPort?: number;
    cli?: string;
  }): Promise<{
    sessionId: string;
    authUrl: string;
    port: number;
    redirectUri: string;
    expiresAt: number;
  }> {
    const cli = options?.cli ?? "agy";
    if (AgyOnboardingService.countActiveSessions() >= MAX_ACTIVE_SESSIONS) {
      throw new Error(
        `Limite de ${MAX_ACTIVE_SESSIONS} sessões de onboarding simultâneas atingido. Cancele uma sessão antes de iniciar outra.`,
      );
    }

    const sessionId = `onboard-${cli}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sockets = new Set<Socket>();

    let serverInstance: Server;

    const server = createServer(async (req, res) => {
      try {
        const address = serverInstance.address();
        const currentPort = typeof address === "object" && address ? address.port : 0;
        const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${currentPort}`);

        if (reqUrl.pathname !== "/callback" && reqUrl.pathname !== "/auth/callback") {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        const errParam = reqUrl.searchParams.get("error");
        if (errParam) {
          const desc = reqUrl.searchParams.get("error_description") || errParam;
          const errHtml = renderErrorPage(desc);
          res.writeHead(400, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": Buffer.byteLength(errHtml, "utf8"),
            Connection: "close",
          });
          res.end(errHtml);
          AgyOnboardingService.markSessionError(sessionId, `Erro Google OAuth: ${desc}`);
          return;
        }

        const code = reqUrl.searchParams.get("code");
        const state = reqUrl.searchParams.get("state");

        if (!code) {
          const errHtml = renderErrorPage("Código de autorização ausente");
          res.writeHead(400, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": Buffer.byteLength(errHtml, "utf8"),
            Connection: "close",
          });
          res.end(errHtml);
          AgyOnboardingService.markSessionError(sessionId, "Código de autorização não recebido na requisição");
          return;
        }

        if (state !== sessionId) {
          const errHtml = renderErrorPage("State mismatch (proteção CSRF)");
          res.writeHead(400, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": Buffer.byteLength(errHtml, "utf8"),
            Connection: "close",
          });
          res.end(errHtml);
          AgyOnboardingService.markSessionError(sessionId, "State mismatch (proteção CSRF)");
          return;
        }

        const sess = activeSessions.get(sessionId);
        if (!sess) {
          const errHtml = renderErrorPage("Sessão de onboarding não encontrada ou expirada");
          res.writeHead(400, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": Buffer.byteLength(errHtml, "utf8"),
            Connection: "close",
          });
          res.end(errHtml);
          return;
        }

        // Para de aceitar novas conexões, mas mantém o socket atual vivo para a resposta.
        try {
          sess.server.close();
        } catch {}

        const endAndClose = (status: number, html: string) => {
          if (res.headersSent) {
            AgyOnboardingService.cleanupServer(sess);
            return;
          }
          res.writeHead(status, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": Buffer.byteLength(html, "utf8"),
            Connection: "close",
          });
          res.end(html, () => {
            AgyOnboardingService.cleanupServer(sess);
          });
        };

        try {
          // Troca o token ANTES de afirmar sucesso na aba do Google.
          await AgyOnboardingService.finalizeTokenExchange(sessionId, code, sess.redirectUri);
          endAndClose(200, renderSuccessPage());
        } catch (err: any) {
          const message = err?.message || String(err);
          endAndClose(400, renderErrorPage(message));
          AgyOnboardingService.markSessionError(sessionId, message);
        }
      } catch (err: any) {
        AgyOnboardingService.markSessionError(sessionId, err.message);
        if (!res.headersSent) {
          try {
            const errHtml = renderErrorPage(err.message || "Erro interno");
            res.writeHead(500, {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Length": Buffer.byteLength(errHtml, "utf8"),
              Connection: "close",
            });
            res.end(errHtml);
          } catch {}
        }
      }
    });

    serverInstance = server;

    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
      });
    });

    // preferredPort is for tests/internal use only; public router should not forward client ports.
    const preferredPort = options?.preferredPort ?? 0;
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(preferredPort, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Falha ao obter porta atribuída ao servidor loopback");
    }
    const port = address.port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authParams = new URLSearchParams({
      client_id: AGY_OAUTH_CONFIG.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: AGY_OAUTH_CONFIG.scopes.join(" "),
      state: sessionId,
      access_type: "offline",
      prompt: "consent",
    });
    const authUrl = `${AGY_OAUTH_CONFIG.authorizeUrl}?${authParams.toString()}`;

    const TIMEOUT_MS = 5 * 60 * 1000;
    const expiresAt = Date.now() + TIMEOUT_MS;
    const timer = setTimeout(() => {
      const current = activeSessions.get(sessionId);
      // Never overwrite a terminal status (error/success/cancelled) with "expired".
      if (!current || TERMINAL_STATUSES.has(current.status)) return;
      AgyOnboardingService.cleanupSession(sessionId, "expired");
      AgyOnboardingService.broadcast({
        type: "onboarding:step",
        sessionId,
        cli,
        step: "error",
        error: "Tempo limite de onboarding esgotado (5 minutos)",
      });
    }, TIMEOUT_MS);
    timer.unref();

    const session: OnboardingSession = {
      id: sessionId,
      cli,
      port,
      server,
      sockets,
      redirectUri,
      authUrl,
      status: "waiting",
      createdAt: Date.now(),
      expiresAt,
      timer,
    };

    activeSessions.set(sessionId, session);

    AgyOnboardingService.broadcast({
      type: "onboarding:step",
      sessionId,
      cli,
      step: "waiting",
      label: "Aguardando autorização no navegador Google...",
      loopbackPort: port,
    });

    return { sessionId, authUrl, port, redirectUri, expiresAt };
  }

  /** Encerra sockets e fecha o servidor HTTP garantindo zero vazamento de descritores ou portas. */
  public static cleanupServer(session: OnboardingSession): void {
    try {
      if (typeof session.server.closeAllConnections === "function") {
        session.server.closeAllConnections();
      }
      for (const socket of session.sockets) {
        try {
          socket.destroy();
        } catch {}
      }
      session.sockets.clear();
      session.server.close();
    } catch {}
  }

  /** Finaliza sessão, cancela timer e encerra o servidor loopback. */
  public static cleanupSession(sessionId: string, finalStatus?: OnboardingSessionStatus): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    if (session.timer) {
      clearTimeout(session.timer);
    }
    AgyOnboardingService.cleanupServer(session);
    // Sem status explícito, trata como cancelamento para liberar o slot ativo.
    if (!TERMINAL_STATUSES.has(session.status) || finalStatus) {
      session.status = finalStatus ?? "cancelled";
    }
    setTimeout(() => {
      const current = activeSessions.get(sessionId);
      if (current && TERMINAL_STATUSES.has(current.status)) {
        activeSessions.delete(sessionId);
      }
    }, 60_000).unref();
  }

  public static markSessionError(sessionId: string, error: string): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    // Keep the first terminal error; don't clobber success.
    if (session.status === "success") return;
    session.status = "error";
    session.error = error;
    AgyOnboardingService.cleanupSession(sessionId, "error");
    AgyOnboardingService.broadcast({
      type: "onboarding:step",
      sessionId,
      cli: session.cli,
      step: "error",
      error,
    });
  }

  public static getSession(sessionId: string): OnboardingSession | undefined {
    return activeSessions.get(sessionId);
  }

  /** Próximo índice livre para `conta_<N>` / `agy-<N>`. */
  public static getNextAccountIndex(): number {
    let maxIdx = 0;

    const poolAccounts = accountPool.getAccounts("agy");
    for (const acc of poolAccounts) {
      const match = /^agy-(\d+)$/.exec(acc.id);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxIdx) maxIdx = n;
      }
    }

    const configPool = config.clis?.agy?.pool;
    if (Array.isArray(configPool)) {
      for (const acc of configPool) {
        const match = /^agy-(\d+)$/.exec(acc.id);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxIdx) maxIdx = n;
        }
      }
    }

    const profilesBase =
      process.env.AGY_PROFILES_DIR || join(homedir(), ".gemini", "antigravity-cli", "profiles");
    if (existsSync(profilesBase)) {
      try {
        const entries = readdirSync(profilesBase);
        for (const entry of entries) {
          const match = /^conta_(\d+)$/.exec(entry);
          if (match) {
            const n = parseInt(match[1], 10);
            if (n > maxIdx) maxIdx = n;
          }
        }
      } catch {}
    }

    return maxIdx + 1;
  }

  /** Cria `conta_<N>` com exclusão mútua (EEXIST → tenta próximo índice). */
  private static allocateProfileDir(): { nextIdx: number; accountId: string; profileDir: string } {
    const profilesBase =
      process.env.AGY_PROFILES_DIR || join(homedir(), ".gemini", "antigravity-cli", "profiles");
    mkdirSync(profilesBase, { recursive: true, mode: 0o700 });

    let nextIdx = AgyOnboardingService.getNextAccountIndex();
    for (let attempt = 0; attempt < 100; attempt++) {
      const profileDir = join(profilesBase, `conta_${nextIdx}`);
      try {
        mkdirSync(profileDir, { recursive: false, mode: 0o700 });
        return { nextIdx, accountId: `agy-${nextIdx}`, profileDir };
      } catch (err: any) {
        if (err?.code === "EEXIST") {
          nextIdx++;
          continue;
        }
        throw err;
      }
    }
    throw new Error("Não foi possível alocar um diretório de perfil isolado para a conta AGY");
  }

  /**
   * Troca o code OAuth, cria perfil isolado, persiste em cockpit.json e registra no accountPool.
   * Claim atômico waiting→configuring evita finalize concorrente.
   */
  public static async finalizeTokenExchange(
    sessionId: string,
    code: string,
    redirectUri: string,
  ): Promise<OnboardingAccountResult> {
    const session = activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Sessão de onboarding não encontrada ou expirada");
    }

    if (session.status === "success" && session.account) {
      return session.account;
    }

    // Compare-and-swap: only one finalize may proceed.
    if (session.status !== "waiting") {
      throw new Error(
        `Sessão ${sessionId} não está aguardando autorização (status atual: ${session.status})`,
      );
    }
    session.status = "configuring";

    AgyOnboardingService.broadcast({
      type: "onboarding:step",
      sessionId,
      cli: session.cli,
      step: "configuring",
      label: "Trocando tokens com a Google e criando perfil...",
    });

    try {
      return await AgyOnboardingService.withAllocationLock(async () => {
        // Re-check after lock: another path may have finished.
        if (session.status === "success" && session.account) {
          return session.account;
        }

        const tokenRes = await fetch(AGY_OAUTH_CONFIG.tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: AGY_OAUTH_CONFIG.clientId,
            client_secret: AGY_OAUTH_CONFIG.clientSecret,
            code,
            redirect_uri: redirectUri,
          }).toString(),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          throw new Error(`Falha no token exchange Google (${tokenRes.status}): ${errText}`);
        }

        const tokenData = (await tokenRes.json()) as {
          access_token: string;
          token_type?: string;
          refresh_token?: string;
          expires_in?: number;
          id_token?: string;
        };

        let email = "";
        if (tokenData.id_token && typeof tokenData.id_token === "string") {
          try {
            const parts = tokenData.id_token.split(".");
            if (parts.length >= 2) {
              const raw = Buffer.from(parts[1], "base64url").toString("utf8");
              const payload = JSON.parse(raw);
              if (payload.email) email = String(payload.email);
            }
          } catch {}
        }

        if (!email && tokenData.access_token) {
          try {
            const uRes = await fetch(AGY_OAUTH_CONFIG.userInfoUrl, {
              headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                Accept: "application/json",
              },
            });
            if (uRes.ok) {
              const uData = (await uRes.json()) as { email?: string };
              if (uData.email) email = String(uData.email);
            }
          } catch {}
        }

        if (!email) {
          email = "conta@google.com";
        }

        const { accountId, profileDir } = AgyOnboardingService.allocateProfileDir();

        const expiresSeconds = Number(tokenData.expires_in) || 3600;
        const expiry = new Date(Date.now() + expiresSeconds * 1000).toISOString();
        const tokenPayload = {
          auth_method: "consumer",
          token: {
            access_token: tokenData.access_token,
            token_type: tokenData.token_type || "Bearer",
            refresh_token: tokenData.refresh_token || "",
            expiry,
          },
          id_token: tokenData.id_token || "",
        };

        const tokenFilePath = join(profileDir, "antigravity-oauth-token");
        writeFileSync(tokenFilePath, JSON.stringify(tokenPayload, null, 2) + "\n", {
          encoding: "utf8",
          mode: 0o600,
        });

        const settingsPayload = {
          model: "Gemini 3.8 Flash (High)",
        };
        const settingsFilePath = join(profileDir, "settings.json");
        writeFileSync(settingsFilePath, JSON.stringify(settingsPayload, null, 2) + "\n", {
          encoding: "utf8",
          mode: 0o600,
        });

        const home = homedir();
        const envDir = profileDir.startsWith(home) ? profileDir.replace(home, "~") : profileDir;

        const accountConfig: ContaPoolSpec = {
          id: accountId,
          label: email,
          env: {
            JETSKI_APP_DATA_DIR: envDir,
            HOME: envDir,
          },
        };

        accountPool.addAccount("agy", accountConfig);

        const result: OnboardingAccountResult = {
          id: accountId,
          label: email,
          profileDir,
          env: accountConfig.env ?? {},
        };

        session.status = "success";
        session.account = result;
        if (session.timer) clearTimeout(session.timer);

        AgyOnboardingService.broadcast({
          type: "onboarding:step",
          sessionId,
          cli: session.cli,
          step: "success",
          account: result,
        });
        AgyOnboardingService.broadcast({
          type: "pool:updated",
          pools: accountPool.getView(),
        });

        // Não fecha o HTTP server aqui: o handler do loopback ainda precisa
        // enviar a página de sucesso neste socket. Agenda só a remoção da memória.
        setTimeout(() => {
          const current = activeSessions.get(sessionId);
          if (current && TERMINAL_STATUSES.has(current.status)) {
            AgyOnboardingService.cleanupServer(current);
            activeSessions.delete(sessionId);
          }
        }, 60_000).unref();

        return result;
      });
    } catch (err: any) {
      const message = err.message || String(err);
      session.status = "error";
      session.error = message;
      if (session.timer) clearTimeout(session.timer);
      AgyOnboardingService.broadcast({
        type: "onboarding:step",
        sessionId,
        cli: session.cli,
        step: "error",
        error: message,
      });
      // Caller (loopback/manual) fecha o server após responder; timer já limpo.
      setTimeout(() => {
        const current = activeSessions.get(sessionId);
        if (current && current.status === "error") {
          AgyOnboardingService.cleanupServer(current);
          activeSessions.delete(sessionId);
        }
      }, 60_000).unref();
      throw err;
    }
  }

  /**
   * Fallback manual: cola a URL redirecionada ou o código de autorização
   * (VPS/headless sem loopback alcançável pelo navegador local).
   */
  public static async handleManualCallback(
    sessionId: string,
    urlOrCode: string,
  ): Promise<OnboardingAccountResult> {
    const session = activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Sessão de onboarding não encontrada ou expirada");
    }

    if (session.status === "success" && session.account) {
      return session.account;
    }

    if (session.status !== "waiting") {
      throw new Error(
        `Sessão ${sessionId} não está aguardando autorização (status atual: ${session.status})`,
      );
    }

    let code = urlOrCode.trim();
    let state = "";

    if (code.startsWith("http://") || code.startsWith("https://") || code.includes("?")) {
      try {
        const urlStr =
          code.startsWith("http://") || code.startsWith("https://")
            ? code
            : code.startsWith("/")
              ? `http://127.0.0.1${code}`
              : `http://127.0.0.1/${code}`;
        const parsed = new URL(urlStr);
        const errParam = parsed.searchParams.get("error");
        if (errParam) {
          const desc = parsed.searchParams.get("error_description") || errParam;
          throw new Error(`Erro Google OAuth: ${desc}`);
        }
        const c = parsed.searchParams.get("code");
        const s = parsed.searchParams.get("state");
        if (!c) {
          throw new Error("URL de retorno não contém o parâmetro code");
        }
        code = c;
        if (s) state = s;
      } catch (err: any) {
        throw new Error(err.message || "URL de retorno não contém o parâmetro code");
      }
    } else if (code.includes("code=")) {
      const params = new URLSearchParams(code);
      const errParam = params.get("error");
      if (errParam) {
        const desc = params.get("error_description") || errParam;
        throw new Error(`Erro Google OAuth: ${desc}`);
      }
      const c = params.get("code");
      const s = params.get("state");
      if (!c) {
        throw new Error("URL de retorno não contém o parâmetro code");
      }
      code = c;
      if (s) state = s;
    }

    if (!code) {
      throw new Error("Código de autorização não encontrado no URL ou parâmetro fornecido");
    }

    if (state && state !== sessionId) {
      throw new Error("State mismatch (proteção CSRF)");
    }

    AgyOnboardingService.cleanupServer(session);

    return await AgyOnboardingService.finalizeTokenExchange(sessionId, code, session.redirectUri);
  }

  /** Reseta todas as sessões ativas (testes). */
  public static resetAllSessions(): void {
    for (const [id, session] of activeSessions.entries()) {
      if (session.timer) clearTimeout(session.timer);
      AgyOnboardingService.cleanupServer(session);
      activeSessions.delete(id);
    }
  }
}
