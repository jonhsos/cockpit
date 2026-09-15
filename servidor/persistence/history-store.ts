import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DiskStore } from "./disk-store.ts";
import type { AuditEvent, Nota } from "./types.ts";

export class HistoryStore {
  private disk: DiskStore;

  constructor(disk: DiskStore) {
    this.disk = disk;
  }

  private globalAuditFile(): string {
    return join(this.disk.getBaseDir(), "audit.jsonl");
  }

  private missionAuditFile(missionId: string): string {
    return join(this.disk.getBaseDir(), "missions", missionId, "audit.jsonl");
  }

  private memoryFile(projectId: string): string {
    return join(this.disk.getBaseDir(), "memoria", `${projectId}.json`);
  }

  public appendAudit(
    event: Omit<AuditEvent, "id" | "timestamp"> & { id?: string; timestamp?: number }
  ): AuditEvent {
    const fullEvent: AuditEvent = {
      ...event,
      id: event.id ?? `aud-${Date.now()}-${randomUUID().slice(0, 8)}`,
      timestamp: event.timestamp ?? Date.now(),
    };

    // Append to global audit log
    this.disk.appendJsonLines(this.globalAuditFile(), fullEvent);

    // If missionId is present, also append to per-mission audit log
    if (fullEvent.missionId) {
      this.disk.appendJsonLines(this.missionAuditFile(fullEvent.missionId), fullEvent);
    }

    return fullEvent;
  }

  public queryAudit(filter?: {
    missionId?: string;
    actor?: string;
    action?: string;
    since?: number;
    limit?: number;
  }): AuditEvent[] {
    const file = filter?.missionId
      ? this.missionAuditFile(filter.missionId)
      : this.globalAuditFile();

    const events = this.disk.readJsonLines<AuditEvent>(file);
    let filtered = events;

    if (filter) {
      if (filter.actor) {
        filtered = filtered.filter((e) => e.actor === filter.actor);
      }
      if (filter.action) {
        filtered = filtered.filter((e) => e.action === filter.action);
      }
      if (filter.since !== undefined) {
        filtered = filtered.filter((e) => e.timestamp >= filter.since!);
      }
    }

    if (filter?.limit && filter.limit > 0) {
      filtered = filtered.slice(-filter.limit);
    }

    return filtered;
  }

  public readMemory(projectId: string): Nota[] {
    const file = this.memoryFile(projectId);
    return this.disk.readJson<Nota[]>(file, []);
  }

  public writeMemory(projectId: string, notas: Nota[]): void {
    const file = this.memoryFile(projectId);
    this.disk.writeJsonAtomic(file, notas);
  }

  public addMemoryNote(projectId: string, quem: string, texto: string): Nota {
    const nota: Nota = { quando: Date.now(), quem, texto: texto.trim() };
    const notas = this.readMemory(projectId);
    notas.push(nota);
    this.writeMemory(projectId, notas);
    return nota;
  }

  public removeMemoryNote(projectId: string, quando: number): void {
    const notas = this.readMemory(projectId).filter((n) => n.quando !== quando);
    this.writeMemory(projectId, notas);
  }
}
