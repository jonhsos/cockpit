import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type Quota = { remaining: number; resetsAt: number | null; checkedAt: number };
export function parseQuota(result: any): Quota | null {
  const bucket = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if (bucket?.limitId && bucket.limitId !== "codex") return null;
  const windows = [bucket?.primary, bucket?.secondary].filter(w => typeof w?.usedPercent === "number" && w.usedPercent >= 0 && w.usedPercent <= 100);
  if (!windows.length) return null;
  const highest = windows.reduce((a, b) => a.usedPercent >= b.usedPercent ? a : b);
  return { remaining: 100 - highest.usedPercent, resetsAt: typeof highest.resetsAt === "number" ? highest.resetsAt : null, checkedAt: Date.now() };
}

/** Read-only account RPC: no turns, no model calls and no credit resets. */
export function readCodexQuota(file: string, args: string[]): Promise<Quota | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args, "app-server"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let finished = false;
    const finish = (err?: Error, quota: Quota | null = null) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); child.stdin.end(); child.kill();
      if (err) reject(err); else resolve(quota);
    };
    const timeout = setTimeout(() => finish(Error("Consulta de cota do Codex expirou.")), 15000);
    child.on("error", err => finish(err));
    let id = 1;
    const send = (method: string, params: any) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }) + "\n");
    const rl = createInterface({ input: child.stdout });
    rl.on("line", line => {
      try {
        const msg = JSON.parse(line);
        if (msg.id === 1) send("account/rateLimits/read", {});
        if (msg.id === 2) finish(undefined, parseQuota(msg.result));
      } catch (err) { finish(err instanceof Error ? err : Error(String(err))); }
    });
    send("initialize", { clientInfo: { name: "cockpit", version: "1.0.0" } });
  });
}
