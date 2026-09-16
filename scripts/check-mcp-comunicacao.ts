import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promptInternoDoPapel } from "../servidor/orchestration/roles.ts";

const mcp = fileURLToPath(new URL("../servidor/orchestration/mcp-maestro.ts", import.meta.url));

function listarTools(extraEnv: Record<string, string>): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mcp], {
      env: { ...process.env, COCKPIT_PORT: "9", COCKPIT_MISSION: "m-test", ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timeout waiting for tools/list"));
    }, 8000);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: { tools?: { name: string }[] } };
          if (msg.id === 1 && msg.result?.tools) {
            clearTimeout(timer);
            child.kill("SIGTERM");
            resolve(msg.result.tools.map((t) => t.name));
            return;
          }
        } catch {
          // JSON-RPC parcial
        }
      }
    });
    child.on("error", reject);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) + "\n",
    );
  });
}

console.log("Verificando MCP de comunicação entre painéis...");

const especialista = await listarTools({
  COCKPIT_MAESTRO: "0",
  COCKPIT_AGENT: "EXPLORADOR",
  COCKPIT_PANE: "p3-abc",
});
assert.ok(especialista.includes("cockpit_ask"), "especialista precisa de cockpit_ask");
assert.ok(especialista.includes("cockpit_list"), "especialista precisa de cockpit_list");
assert.ok(especialista.includes("cockpit_inbox"), "especialista precisa de cockpit_inbox");
assert.ok(especialista.includes("cockpit_reply"), "especialista precisa de cockpit_reply");
assert.ok(!especialista.includes("delegar"), "especialista NÃO deve ver delegar");
assert.ok(!especialista.includes("cockpit_handoff"), "handoff é orquestração, só Maestro");
assert.ok(!especialista.includes("procurar_no_marketplace"), "especialista não orquestra marketplace");

const maestro = await listarTools({
  COCKPIT_MAESTRO: "1",
  COCKPIT_AGENT: "MAESTRO",
  COCKPIT_PANE: "p1-abc",
});
assert.ok(maestro.includes("delegar"), "maestro continua com delegar");
assert.ok(maestro.includes("cockpit_ask"), "maestro também fala com painéis");

const contrato = promptInternoDoPapel({ role: "scout", agent: "scout", tarefa: "mapear repo" });
assert.match(contrato, /cockpit_ask/);
assert.match(contrato, /Se NÃO houver Maestro/);

console.log("PASS: check-mcp-comunicacao.ts — especialistas falam entre si; Maestro orquestra.");
