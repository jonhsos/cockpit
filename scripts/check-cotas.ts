// Redline: os três leitores de cota, sem gastar cota nenhuma.
// Uso: node scripts/check-cotas.ts
import { aplicarSinal, lerBloqueioAgy, lerBucketCodex, extrairLimiteClaude, type Cota } from "../servidor/cotas.ts";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? "  ok  " : " FALHA", msg);
  if (!cond) falhas++;
};

console.log("=== CODEX — duas janelas, pela conta ===");
const duas = lerBucketCodex({
  rateLimitsByLimitId: {
    codex: {
      planType: "plus",
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1789019040 },
      secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1789605840 },
    },
  },
})!;
ok(duas.janelas.length === 2, "lê as duas janelas, não só a pior");
ok(duas.janelas[0]!.rotulo === "5h" && duas.janelas[1]!.rotulo === "7 dias", `rótulos: ${duas.janelas.map((j) => j.rotulo).join(", ")}`);
ok(duas.plano === "plus", "traz o plano");
ok(duas.estado === "livre", "42% usado é livre");
ok(duas.janelas[0]!.voltaEm === 1789019040_000, "converte resetsAt de segundos para ms");

ok(lerBucketCodex({ rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300 } } })!.estado === "bloqueado", "100% usado é bloqueado");
ok(lerBucketCodex({ rateLimits: { primary: { usedPercent: 90, windowDurationMins: 300 } } })!.estado === "apertado", "10% restante é apertado");
ok(lerBucketCodex({}) === null, "resposta vazia não vira cota inventada");
ok(lerBucketCodex({ rateLimits: { primary: { usedPercent: -5 } } }) === null, "porcentagem impossível é descartada");

console.log("\n=== AGY — só o bloqueio, que é o que ele publica ===");
const modelo = (quando: Date) =>
  `I${String(quando.getMonth() + 1).padStart(2, "0")}${String(quando.getDate()).padStart(2, "0")} ${quando.toTimeString().slice(0, 8)}.016968 84364 run.go:371] Run: attempt 1 failed (RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 3h44m55s.), retrying in 1s`;

const recente = lerBloqueioAgy(modelo(new Date(Date.now() - 60_000)));
ok(recente?.estado === "bloqueado", "429 de um minuto atrás bloqueia");
ok(recente?.janelas.length === 0, "e não inventa porcentagem");

const velho = new Date();
velho.setDate(velho.getDate() - 3);
ok(lerBloqueioAgy(modelo(velho)) === null, "429 de três dias atrás já venceu");
ok(lerBloqueioAgy("nada de anormal aqui") === null, "log limpo não vira bloqueio");

console.log("\n=== CLAUDE — o que houver, e nada além ===");
ok(extrairLimiteClaude({ token: "segredo" }) === null, "sem campo de limite, devolve null");
const comNumero = extrairLimiteClaude({ oauth: { rateLimit: { remaining: 8, resetsAt: 1789019040 } } })!;
ok(comNumero.janelas[0]?.usadoPct === 92, "converte 'remaining' em usado");
ok(comNumero.estado === "apertado", "8% restante é apertado");
const soStatus = extrairLimiteClaude({ rateLimit: { status: "exceeded" } })!;
ok(soStatus.estado === "bloqueado", "status 'exceeded' bloqueia mesmo sem número");
const estranho = extrairLimiteClaude({ rateLimit: { coisaNova: 42 } })!;
ok(estranho.estado === "desconhecido" && /coisaNova:number/.test(estranho.detalhe ?? ""), "formato novo reporta a FORMA, sem valores");
const { lidoEm: _t, ...semData } = estranho;
ok(!JSON.stringify(semData).includes("42"), "e nenhum valor vaza no relato");

console.log("\n=== o aviso do painel sobrepõe a conta ===");
const base: Cota[] = [
  { cli: "claude", estado: "desconhecido", janelas: [], plano: null, detalhe: null, fonte: "x", lidoEm: 0 },
  { cli: "codex", estado: "livre", janelas: [{ rotulo: "5h", usadoPct: 10, voltaEm: null }], plano: null, detalhe: null, fonte: "conta", lidoEm: 0 },
];
const comSinal = aplicarSinal(base, new Map([["claude", { state: "blocked", detail: "limite atingido" }]]));
ok(comSinal[0]!.estado === "bloqueado", "painel avisou: claude vira bloqueado");
ok(comSinal[1]!.estado === "livre", "e não mexe em quem não avisou");

const comAviso = aplicarSinal(base, new Map([["claude", { state: "warning", remaining: 5 }]]));
ok(comAviso[0]!.janelas[0]?.usadoPct === 95, "aviso com número vira janela");

console.log(falhas === 0 ? "\nPASS: cotas" : `\nFALHOU: ${falhas}`);
process.exit(falhas === 0 ? 0 : 1);
