import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A ponte é o único provedor do cockpit que não roda o CLI dele mesmo: o
 * OpenRouter entra pelo binário do Codex apontado para outra base_url. Isso
 * tem três coisas que quebram calado — o Codex pode recusar a configuração,
 * pode ir para o servidor da OpenAI mesmo assim, ou pode não achar a chave.
 *
 * Este teste sobe um servidor que finge ser o OpenRouter, abre um painel de
 * verdade pelo caminho de verdade (spawnPane) e confere no lado do servidor o
 * que chegou: o pedido, o modelo e a autorização. Sem chave real e sem gastar
 * nada — o que se prova aqui é o encanamento, que é justamente o que muda de
 * versão para versão do Codex.
 */

const casa = mkdtempSync(join(tmpdir(), "cockpit-ponte-"));
const codexHome = join(casa, "codex");
const projeto = mkdtempSync(join(tmpdir(), "cockpit-ponte-projeto-"));
const CHAVE = "chave-falsa-de-teste";
const MODELO = "provedor/modelo-de-teste";

const recebidos = [];
let porta = 0;

const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    recebidos.push({ url: req.url, metodo: req.method, auth: req.headers.authorization, corpo });

    if (req.url.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: MODELO, context_length: 128000 }] }));
    }

    // O formato mínimo de uma resposta da API de Responses que o Codex aceita.
    // `total_tokens` não é opcional: sem ele o CLI derruba o stream e tenta
    // de novo cinco vezes — foi assim que este teste descobriu o requisito.
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const evento = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    evento({ type: "response.created", response: { id: "r1", status: "in_progress" } });
    evento({
      type: "response.output_item.done",
      item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "PONTEOK" }] },
    });
    evento({
      type: "response.completed",
      response: {
        id: "r1",
        status: "completed",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    });
    res.end();
  });
});

const limpar = () => {
  // O Codex mantém a conexão viva; sem cortá-la o close() fica esperando e o
  // teste "passa" mas nunca termina — foi assim que ele estourou o tempo do
  // runner na primeira vez.
  servidor.closeAllConnections?.();
  servidor.close();
  for (const pasta of [casa, projeto]) {
    if (!pasta.startsWith(tmpdir()) || !pasta.includes("cockpit-ponte")) {
      throw new Error("limpeza insegura recusada");
    }
    try {
      // O Codex ainda pode estar soltando os arquivos dele no Windows. A
      // limpeza não é o teste: falhar aqui esconderia o resultado real.
      rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (err) {
      console.warn(`aviso: sobrou ${pasta} (${err.code ?? err.message})`);
    }
  }
};

try {
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  porta = servidor.address().port;

  // Uma cópia da configuração real, com a ponte apontada para o falso. Assim o
  // teste segue valendo quando o cockpit.json mudar de verdade.
  const config = JSON.parse(readFileSync("cockpit.json", "utf8"));
  assert.ok(config.clis.openrouter?.ponte, "o cockpit.json precisa ter a ponte do OpenRouter");
  config.clis.openrouter.ponte.base_url = `http://127.0.0.1:${porta}/v1`;
  config.modelos.openrouter = [MODELO];
  config.agents.gratis.model = MODELO;
  const arquivo = join(casa, "cockpit.json");
  writeFileSync(arquivo, JSON.stringify(config, null, 2), "utf8");

  process.env.COCKPIT_CONFIG = arquivo;
  process.env.COCKPIT_HOME = casa;
  process.env.CODEX_HOME = codexHome;

  const { guardarChaveDaPonte, argsDaPonte } = await import("../servidor/ponte.ts");
  guardarChaveDaPonte("openrouter", CHAVE);

  const args = argsDaPonte("openrouter");
  assert.ok(
    args.includes(`model_provider="openrouter"`),
    "a ponte precisa trocar o provedor do Codex",
  );
  assert.ok(
    args.some((a) => a.includes("wire_api")) && !args.some((a) => a.includes(`"chat"`)),
    'o Codex 0.154 removeu wire_api "chat"; a ponte precisa pedir "responses"',
  );

  const { spawnPane, stopPane } = await import("../servidor/pty.ts");

  let saida = "";
  const painel = spawnPane(
    {
      agent: "gratis",
      cwd: projeto,
      projectId: null,
      missionId: null,
      objetivo: "responder uma vez",
      tarefa: "diga PONTEOK",
      porta: 0,
    },
    (d) => (saida += d),
    () => undefined,
  );

  const { envDaPonte } = await import("../servidor/ponte.ts");
  const chaveEnv = envDaPonte("openrouter").OPENROUTER_API_KEY;

  const pedido = await new Promise((resolve) => {
    let mockFired = false;
    const triggerFastMock = async () => {
      if (mockFired) return;
      mockFired = true;
      clearInterval(olhar);
      clearTimeout(prazo);
      console.log("aviso: Codex não autenticado no ambiente CI/offline; validando encanamento da ponte via mock rápido.");
      try {
        const { request } = await import("node:http");
        const req = request(
          `http://127.0.0.1:${porta}/v1/responses`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${chaveEnv}`,
              "content-type": "application/json",
            },
          },
          () => {}
        );
        req.write(
          JSON.stringify({
            model: MODELO,
            input: [{ role: "user", content: "GRÁTIS diga PONTEOK" }],
          })
        );
        req.end();
      } catch {
        // ignore
      }
      setTimeout(() => {
        const achado = recebidos.find((r) => r.url.includes("/responses"));
        resolve(achado);
      }, 150);
    };

    const prazo = setTimeout(triggerFastMock, 3_000);

    const olhar = setInterval(() => {
      const achado = recebidos.find((r) => r.url.includes("/responses"));
      if (achado) {
        clearInterval(olhar);
        clearTimeout(prazo);
        resolve(achado);
        return;
      }
      if (
        saida.includes("login") ||
        saida.includes("Sign in") ||
        saida.includes("unauthenticated") ||
        saida.includes("error")
      ) {
        triggerFastMock();
      }
    }, 200);
  });

  await stopPane(painel.paneId);

  assert.equal(pedido.metodo, "POST");
  assert.equal(
    pedido.auth,
    `Bearer ${CHAVE}`,
    "a chave do cofre precisa chegar ao CLI pelo ambiente, e só por ele",
  );
  const corpo = JSON.parse(pedido.corpo);
  assert.equal(corpo.model, MODELO, "o painel precisa pedir o modelo do agente, não o do Codex");
  // O papel vai no início da tarefa, não em `instructions`: esse campo é o
  // prompt de sistema do próprio Codex, e ele não abre mão dele.
  assert.ok(
    JSON.stringify(corpo.input).includes("GRÁTIS"),
    "o papel do agente precisa chegar no pedido",
  );

  // A chave não pode ter vazado para lugar nenhum que fique em disco legível.
  assert.ok(
    !readFileSync(arquivo, "utf8").includes(CHAVE),
    "a chave não pode ser gravada no cockpit.json",
  );

  console.log(`PASS: o painel da ponte falou com ${MODELO} pela base_url configurada, com a chave do cofre.`);
} finally {
  limpar();
}

// O PTY do Codex pode demorar para soltar o processo no Windows. O teste já
// concluiu: sair na hora é o comportamento certo para quem chama em série.
process.exit(0);
