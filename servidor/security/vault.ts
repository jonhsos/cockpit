import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SecretRegistry } from "./sanitizer.ts";

function getCASA(): string {
  return process.env.COCKPIT_HOME ?? join(homedir(), ".cockpit");
}

function cofrePath(): string {
  return join(getCASA(), "chaves.json");
}

function mestraPath(): string {
  return join(getCASA(), "chave-mestra");
}

function chaveMestra(): Buffer {
  const casa = getCASA();
  mkdirSync(casa, { recursive: true });
  const mestra = mestraPath();
  if (!existsSync(mestra)) {
    writeFileSync(mestra, randomBytes(32), { mode: 0o600 });
  }
  return readFileSync(mestra);
}

type Cofre = Record<string, { iv: string; tag: string; dado: string }>;

function lerCofre(): Cofre {
  const caminho = cofrePath();
  return existsSync(caminho) ? (JSON.parse(readFileSync(caminho, "utf8")) as Cofre) : {};
}

export function guardarChave(provedor: string, valor: string): void {
  const cofre = lerCofre();
  if (!valor) {
    delete cofre[provedor];
  } else {
    // Automatically register with SecretRegistry
    SecretRegistry.register(valor);

    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", chaveMestra(), iv);
    const dado = Buffer.concat([c.update(valor, "utf8"), c.final()]);
    cofre[provedor] = {
      iv: iv.toString("base64"),
      tag: c.getAuthTag().toString("base64"),
      dado: dado.toString("base64"),
    };
  }
  mkdirSync(getCASA(), { recursive: true });
  writeFileSync(cofrePath(), JSON.stringify(cofre, null, 2), { mode: 0o600 });
}

export function lerChave(provedor: string): string | null {
  const guardada = lerCofre()[provedor];
  if (!guardada) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", chaveMestra(), Buffer.from(guardada.iv, "base64"));
    d.setAuthTag(Buffer.from(guardada.tag, "base64"));
    const decrypted = Buffer.concat([
      d.update(Buffer.from(guardada.dado, "base64")),
      d.final(),
    ]).toString("utf8");

    // Automatically register read secret with SecretRegistry
    SecretRegistry.register(decrypted);
    return decrypted;
  } catch {
    return null;
  }
}

export function chaveDe(
  id: string,
  variavel?: string
): { valor: string | null; onde: string } {
  const guardada = lerChave(id);
  if (guardada) {
    SecretRegistry.register(guardada);
    return { valor: guardada, onde: "cofre do cockpit" };
  }
  const doAmbiente = variavel ? process.env[variavel] : undefined;
  if (doAmbiente) {
    SecretRegistry.register(doAmbiente);
    return { valor: doAmbiente, onde: variavel! };
  }
  return { valor: null, onde: "" };
}
