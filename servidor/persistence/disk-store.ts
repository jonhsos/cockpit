import {
  existsSync,
  mkdirSync,
  readFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  readdirSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export class DiskStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
    mkdirSync(this.baseDir, { recursive: true });
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public ensureDir(dirPath: string): void {
    mkdirSync(resolve(dirPath), { recursive: true });
  }

  public writeAtomicSync(filePath: string, content: string | Buffer): void {
    const absPath = resolve(filePath);
    const dir = dirname(absPath);
    mkdirSync(dir, { recursive: true });

    // Temp file in the EXACT same directory guarantees same filesystem for atomic rename
    const tmpPath = join(
      dir,
      `.${randomUUID().slice(0, 8)}.tmp.${process.pid}.${Date.now()}`
    );

    let fd: number | null = null;
    try {
      fd = openSync(tmpPath, "w", 0o600);
      const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
      writeSync(fd, buffer, 0, buffer.length, 0);
      fsyncSync(fd);
      closeSync(fd);
      fd = null;

      // Atomic rename with retry loop for Windows file locking
      let retries = 5;
      while (retries > 0) {
        try {
          renameSync(tmpPath, absPath);
          break;
        } catch (err: any) {
          retries--;
          if (
            retries === 0 ||
            (err.code !== "EPERM" && err.code !== "EACCES" && err.code !== "EBUSY")
          ) {
            throw err;
          }
          // Sleep briefly for unlock
          const waitTill = Date.now() + 25 * (6 - retries);
          while (Date.now() < waitTill) {
            /* busy spin for brief sync sleep */
          }
        }
      }
    } catch (err) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
      }
      if (existsSync(tmpPath)) {
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
      }
      throw err;
    }
  }

  public readJson<T>(filePath: string, fallback: T): T {
    const absPath = resolve(filePath);
    if (!existsSync(absPath)) return fallback;
    try {
      const text = readFileSync(absPath, "utf8");
      return JSON.parse(text) as T;
    } catch (err) {
      console.error(`[DiskStore] Failed to parse JSON at ${absPath}, using fallback:`, err);
      return fallback;
    }
  }

  public writeJsonAtomic<T>(filePath: string, data: T): void {
    const json = JSON.stringify(data, null, 2);
    this.writeAtomicSync(filePath, json);
  }

  public appendJsonLines(filePath: string, line: unknown): void {
    const absPath = resolve(filePath);
    const dir = dirname(absPath);
    mkdirSync(dir, { recursive: true });
    const payload = JSON.stringify(line) + "\n";
    appendFileSync(absPath, payload, "utf8");
  }

  public readJsonLines<T>(filePath: string): T[] {
    const absPath = resolve(filePath);
    if (!existsSync(absPath)) return [];
    const content = readFileSync(absPath, "utf8");
    const results: T[] = [];
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed) as T);
      } catch {
        // Skip corrupted or incomplete line
      }
    }
    return results;
  }

  public cleanOrphanTmpFiles(dirPath: string, maxAgeMs = 5 * 60 * 1000): void {
    const absDir = resolve(dirPath);
    if (!existsSync(absDir)) return;
    try {
      const entries = readdirSync(absDir, { withFileTypes: true });
      const now = Date.now();
      for (const entry of entries) {
        const fullPath = join(absDir, entry.name);
        if (entry.isDirectory()) {
          this.cleanOrphanTmpFiles(fullPath, maxAgeMs);
        } else if (entry.isFile() && entry.name.includes(".tmp.")) {
          try {
            const stats = statSync(fullPath);
            if (now - stats.mtimeMs > maxAgeMs) {
              unlinkSync(fullPath);
            }
          } catch {
            /* ignore individual stat/unlink errors */
          }
        }
      }
    } catch {
      // Best effort cleanup
    }
  }
}
