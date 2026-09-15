import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DiskStore } from "../persistence/disk-store.ts";
import type { MailboxMessage } from "./connection-types.ts";

export type PaneMailbox = {
  inbox: MailboxMessage[];
  outbox: MailboxMessage[];
};

export class MailboxStore {
  private disk: DiskStore;

  constructor(disk: DiskStore) {
    this.disk = disk;
  }

  private mailboxFile(missionId: string): string {
    return join(this.disk.getBaseDir(), "missions", missionId, "mailboxes.json");
  }

  public loadMailboxes(missionId: string): Record<string, PaneMailbox> {
    if (!missionId) return {};
    return this.disk.readJson<Record<string, PaneMailbox>>(this.mailboxFile(missionId), {});
  }

  public saveMailboxes(missionId: string, data: Record<string, PaneMailbox>): void {
    if (!missionId) return;
    this.disk.writeJsonAtomic(this.mailboxFile(missionId), data);
  }

  public clear(missionId?: string): void {
    if (missionId) {
      this.disk.writeJsonAtomic(this.mailboxFile(missionId), {});
      return;
    }
    const missionsDir = join(this.disk.getBaseDir(), "missions");
    if (!existsSync(missionsDir)) return;
    const dirs = readdirSync(missionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const mId of dirs) {
      this.disk.writeJsonAtomic(this.mailboxFile(mId), {});
    }
  }
}
