import { createServer as createNetServer } from "node:net";

export interface ServerOptions {
  port: number;
  host?: string;
  strict: boolean;
}

export function parseServerOptions(
  argv: string[] = process.argv.slice(2),
  defaultPort = 3000,
): ServerOptions {
  let explicitPort: number | undefined;
  let explicitHost: string | undefined;
  let strict =
    process.env.COCKPIT_STRICT_PORT === "1" ||
    process.env.COCKPIT_STRICT_PORT === "true";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--strict-port") {
      strict = true;
    } else if (arg === "--port" || arg === "-p" || arg === "port") {
      const next = argv[++i];
      if (next !== undefined) {
        const parsed = Number(next);
        if (!Number.isNaN(parsed)) explicitPort = parsed;
      }
    } else if (arg.startsWith("--port=")) {
      const parsed = Number(arg.slice(7));
      if (!Number.isNaN(parsed)) explicitPort = parsed;
    } else if (arg.startsWith("-p=")) {
      const parsed = Number(arg.slice(3));
      if (!Number.isNaN(parsed)) explicitPort = parsed;
    } else if (arg === "--host" || arg === "-h" || arg === "host") {
      const next = argv[++i];
      if (next !== undefined) explicitHost = next;
    } else if (arg.startsWith("--host=")) {
      explicitHost = arg.slice(7);
    } else if (arg.startsWith("-h=")) {
      explicitHost = arg.slice(3);
    } else if (/^\d+$/.test(arg)) {
      explicitPort = Number(arg);
    } else if (
      arg === "localhost" ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(arg) ||
      /^::1?$/.test(arg)
    ) {
      explicitHost = arg;
    }
  }

  const envPortRaw =
    process.env.COCKPIT_PORTA ||
    process.env.COCKPIT_PORT ||
    process.env.PORT;
  const envPort = envPortRaw ? Number(envPortRaw) : undefined;

  const port =
    explicitPort !== undefined && !Number.isNaN(explicitPort)
      ? explicitPort
      : envPort !== undefined && !Number.isNaN(envPort)
      ? envPort
      : defaultPort;

  const host =
    explicitHost ||
    process.env.COCKPIT_HOST ||
    process.env.HOST ||
    undefined;

  return { port, host, strict };
}

export async function isPortAvailable(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createNetServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    if (host) {
      tester.listen(port, host);
    } else {
      tester.listen(port);
    }
  });
}

export async function resolveServerPort(
  preferred: number,
  host?: string,
  strict = false,
): Promise<number> {
  if (preferred === 0) {
    return new Promise((resolve, reject) => {
      const tester = createNetServer();
      tester.once("error", reject);
      tester.once("listening", () => {
        const addr = tester.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        tester.close((err) => (err ? reject(err) : resolve(p)));
      });
      if (host) {
        tester.listen(0, host);
      } else {
        tester.listen(0);
      }
    });
  }

  if (await isPortAvailable(preferred, host)) {
    return preferred;
  }

  if (strict) {
    console.error(`[cockpit] a porta ${preferred} já está em uso — saindo`);
    process.exit(1);
  }

  for (let p = preferred + 1; p < preferred + 100; p++) {
    if (await isPortAvailable(p, host)) {
      console.log(`[cockpit] a porta ${preferred} já está em uso — usando a porta ${p}`);
      return p;
    }
  }

  console.error(`[cockpit] nenhuma porta livre encontrada entre ${preferred} e ${preferred + 99} — saindo`);
  process.exit(1);
}
