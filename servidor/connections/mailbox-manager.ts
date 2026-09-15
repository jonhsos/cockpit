import { randomUUID } from "node:crypto";
import type { MailboxMessage } from "./connection-types.ts";
import type { MailboxStore, PaneMailbox } from "./mailbox-store.ts";

export type MailboxEventListener = (
  event: "inbox:message",
  payload: { targetPane: string; message: MailboxMessage },
) => void;

export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_QUEUE_CAPACITY = 1000;

export class MailboxManager {
  private store: MailboxStore;
  // missionId -> paneId -> PaneMailbox
  private mailboxes: Map<string, Map<string, PaneMailbox>> = new Map();
  private listeners: Set<MailboxEventListener> = new Set();

  constructor(store: MailboxStore) {
    this.store = store;
  }

  public addListener(listener: MailboxEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(
    event: "inbox:message",
    payload: { targetPane: string; message: MailboxMessage },
  ): void {
    for (const l of this.listeners) {
      try {
        l(event, payload);
      } catch (err) {
        console.error("[MailboxManager] Listener error:", err);
      }
    }
  }

  private getMissionMailboxes(missionId: string): Map<string, PaneMailbox> {
    const mId = missionId || "default";
    let mm = this.mailboxes.get(mId);
    if (!mm) {
      mm = new Map<string, PaneMailbox>();
      // Load from disk store if available
      try {
        const persisted = this.store.loadMailboxes(mId);
        for (const [paneId, box] of Object.entries(persisted)) {
          mm.set(paneId, {
            inbox: Array.isArray(box.inbox) ? [...box.inbox] : [],
            outbox: Array.isArray(box.outbox) ? [...box.outbox] : [],
          });
        }
      } catch {
        // start with empty in-memory
      }
      this.mailboxes.set(mId, mm);
    }
    return mm;
  }

  private getPaneBox(missionId: string, paneId: string): PaneMailbox {
    const mm = this.getMissionMailboxes(missionId);
    let box = mm.get(paneId);
    if (!box) {
      box = { inbox: [], outbox: [] };
      mm.set(paneId, box);
    }
    return box;
  }

  private persist(missionId: string): void {
    const mId = missionId || "default";
    const mm = this.mailboxes.get(mId);
    if (!mm) return;
    const serializable: Record<string, PaneMailbox> = {};
    for (const [paneId, box] of mm.entries()) {
      serializable[paneId] = {
        inbox: box.inbox,
        outbox: box.outbox,
      };
    }
    this.store.saveMailboxes(mId, serializable);
  }

  public enqueue(
    data: Omit<MailboxMessage, "id" | "timestamp" | "status"> & {
      id?: string;
      timestamp?: number;
      status?: "unread" | "read";
    },
  ): MailboxMessage {
    const missionId = data.missionId || "default";

    // 1. Check payload limit (5MB)
    const jsonStr = JSON.stringify(data);
    const byteLength = Buffer.byteLength(jsonStr, "utf8");
    if (byteLength > MAX_PAYLOAD_BYTES) {
      throw new Error(`Payload too large: ${byteLength} bytes exceeds 5MB limit`);
    }

    // 2. Check destination mailbox queue capacity (1000 cap)
    const recipientBox = this.getPaneBox(missionId, data.to);
    if (recipientBox.inbox.length >= MAX_QUEUE_CAPACITY) {
      throw new Error(
        `Mailbox overflow: inbox queue for pane ${data.to} reached capacity of ${MAX_QUEUE_CAPACITY} messages`,
      );
    }

    const now = Date.now();
    const message: MailboxMessage = {
      id: data.id ?? `msg-${now}-${randomUUID().slice(0, 8)}`,
      from: data.from,
      to: data.to,
      type: data.type,
      correlationId: data.correlationId,
      taskId: data.taskId,
      task: data.task,
      result: data.result,
      evidence: data.evidence,
      status: data.status ?? "unread",
      timestamp: data.timestamp ?? now,
      missionId,
      metadata: data.metadata,
    };

    // Append to recipient inbox (FIFO)
    recipientBox.inbox.push(message);

    // If sender pane provided and not system/maestro/anonymous, record in outbox
    if (data.from && data.from !== "system" && data.from !== "user") {
      const senderBox = this.getPaneBox(missionId, data.from);
      senderBox.outbox.push(message);
    }

    // Persist changes
    this.persist(missionId);

    // Emit event (WS broadcast)
    this.emit("inbox:message", { targetPane: data.to, message });

    return message;
  }

  public getInbox(
    paneId: string,
    missionId = "default",
    unreadOnly = false,
  ): MailboxMessage[] {
    const box = this.getPaneBox(missionId, paneId);
    if (unreadOnly) {
      return box.inbox.filter((m) => m.status === "unread");
    }
    return [...box.inbox];
  }

  public getOutbox(paneId: string, missionId = "default"): MailboxMessage[] {
    const box = this.getPaneBox(missionId, paneId);
    return [...box.outbox];
  }

  public markRead(
    paneId: string,
    messageId: string,
    missionId = "default",
  ): boolean {
    const box = this.getPaneBox(missionId, paneId);
    const msg = box.inbox.find((m) => m.id === messageId);
    if (msg) {
      msg.status = "read";
      this.persist(missionId);
      return true;
    }
    return false;
  }

  public pop(paneId: string, missionId = "default"): MailboxMessage | undefined {
    const box = this.getPaneBox(missionId, paneId);
    const msg = box.inbox.shift();
    if (msg) {
      msg.status = "read";
      this.persist(missionId);
    }
    return msg;
  }

  public peek(paneId: string, missionId = "default"): MailboxMessage | undefined {
    const box = this.getPaneBox(missionId, paneId);
    return box.inbox[0];
  }

  public getUnreadCount(paneId: string, missionId = "default"): number {
    const box = this.getPaneBox(missionId, paneId);
    return box.inbox.filter((m) => m.status === "unread").length;
  }

  public findMessage(
    paneId: string,
    messageId: string,
    missionId = "default",
  ): MailboxMessage | undefined {
    const box = this.getPaneBox(missionId, paneId);
    return box.inbox.find((m) => m.id === messageId) ?? box.outbox.find((m) => m.id === messageId);
  }

  public clear(missionId?: string): void {
    if (missionId) {
      this.mailboxes.delete(missionId);
      this.store.clear(missionId);
    } else {
      this.mailboxes.clear();
      this.store.clear();
    }
  }
}
