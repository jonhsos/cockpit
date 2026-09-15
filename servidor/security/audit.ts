import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AuditEntry,
  AuditCategory,
  AuditSeverity,
  AuditActor,
} from "./types.ts";
import { sanitizeObject } from "./sanitizer.ts";

export class AuditLogger {
  private rootPath: string;

  constructor(rootPath?: string) {
    this.rootPath = rootPath ?? process.env.COCKPIT_HOME ?? join(homedir(), ".cockpit");
  }

  public getRootPath(): string {
    return this.rootPath;
  }

  private globalLogPath(): string {
    return join(this.rootPath, "audit.jsonl");
  }

  private missionLogPath(missionId: string): string {
    return join(this.rootPath, "missions", missionId, "audit.jsonl");
  }

  public log(entry: Omit<AuditEntry, "id" | "timestamp" | "isoDate">): AuditEntry {
    const now = Date.now();
    const fullEntry: AuditEntry = {
      ...entry,
      id: `audit-${now}-${randomUUID().slice(0, 8)}`,
      timestamp: now,
      isoDate: new Date(now).toISOString(),
    };

    // Sanitize before writing to disk
    const sanitizedEntry = sanitizeObject(fullEntry);
    const line = JSON.stringify(sanitizedEntry) + "\n";

    // Write to global audit log
    const globalPath = this.globalLogPath();
    mkdirSync(dirname(globalPath), { recursive: true });
    appendFileSync(globalPath, line, "utf8");

    // If missionId is specified, also append to mission audit log
    if (sanitizedEntry.missionId) {
      const missionPath = this.missionLogPath(sanitizedEntry.missionId);
      mkdirSync(dirname(missionPath), { recursive: true });
      appendFileSync(missionPath, line, "utf8");
    }

    return sanitizedEntry;
  }

  public logAction(
    action: string,
    actor: AuditActor,
    details: Record<string, unknown>,
    context?: { missionId?: string; paneId?: string; taskId?: string }
  ): AuditEntry {
    return this.log({
      category: "activity",
      severity: "info",
      action,
      actor,
      missionId: context?.missionId,
      paneId: context?.paneId,
      taskId: context?.taskId,
      details,
    });
  }

  public logTokenUsage(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    context?: { missionId?: string; paneId?: string }
  ): AuditEntry {
    return this.log({
      category: "token",
      severity: "info",
      action: "token_usage",
      actor: { type: "system", id: "billing" },
      missionId: context?.missionId,
      paneId: context?.paneId,
      details: {
        provider,
        model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd,
      },
      metadata: {
        cost: {
          inputTokens,
          outputTokens,
          costUsd,
          provider,
          model,
        },
      },
    });
  }

  public logAdminCommand(
    command: string,
    actor: AuditActor,
    details: Record<string, unknown>,
    missionId?: string
  ): AuditEntry {
    return this.log({
      category: "admin",
      severity: "warn",
      action: `admin:${command}`,
      actor,
      missionId,
      details,
    });
  }

  public logExecutorChange(
    de: string,
    para: string,
    reason: string,
    context?: { missionId?: string; paneId?: string }
  ): AuditEntry {
    return this.log({
      category: "executor_change",
      severity: "warn",
      action: "executor_switch",
      actor: { type: "system", id: "orchestrator" },
      missionId: context?.missionId,
      paneId: context?.paneId,
      details: {
        from: de,
        to: para,
        reason,
      },
    });
  }

  public logTestRun(
    testName: string,
    passed: boolean,
    durationMs: number,
    output?: string,
    missionId?: string
  ): AuditEntry {
    return this.log({
      category: "test_run",
      severity: passed ? "info" : "error",
      action: "test_execution",
      actor: { type: "agent", id: "test-runner" },
      missionId,
      details: {
        testName,
        passed,
        durationMs,
        output,
      },
      metadata: {
        executionTimeMs: durationMs,
        status: passed ? "passed" : "failed",
      },
    });
  }

  public logSecurityEvent(
    action: string,
    severity: AuditSeverity,
    details: Record<string, unknown>,
    missionId?: string
  ): AuditEntry {
    return this.log({
      category: "security",
      severity,
      action,
      actor: { type: "system", id: "security-guard" },
      missionId,
      details,
    });
  }

  public async query(filter: {
    missionId?: string;
    category?: AuditCategory;
    since?: number;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const filePath = filter.missionId
      ? this.missionLogPath(filter.missionId)
      : this.globalLogPath();

    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const results: AuditEntry[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as AuditEntry;
        if (filter.category && entry.category !== filter.category) continue;
        if (filter.since !== undefined && entry.timestamp < filter.since) continue;
        results.push(entry);
      } catch {
        // Skip invalid JSON lines
      }
    }

    if (filter.limit && filter.limit > 0) {
      return results.slice(-filter.limit);
    }

    return results;
  }
}

export const auditLogger = new AuditLogger();
