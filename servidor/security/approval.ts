import { randomUUID } from "node:crypto";
import type {
  ConfirmationRequest,
  DestructiveActionType,
  AuditActor,
} from "./types.ts";

export class ApprovalManager {
  private requests: Map<string, ConfirmationRequest> = new Map();

  public createRequest(params: {
    action: DestructiveActionType;
    title: string;
    description: string;
    severity?: "warn" | "danger" | "critical";
    target: Record<string, unknown>;
    requestedBy: AuditActor;
    ttlMs?: number; // default: 300,000 (5 min)
  }): ConfirmationRequest {
    const now = Date.now();
    const id = `conf-${now}-${randomUUID().slice(0, 8)}`;
    const ttl = params.ttlMs ?? 300_000;

    const request: ConfirmationRequest = {
      id,
      action: params.action,
      title: params.title,
      description: params.description,
      severity: params.severity ?? "warn",
      target: params.target,
      requestedBy: params.requestedBy,
      createdAt: now,
      expiresAt: now + ttl,
      status: "pending",
    };

    this.requests.set(id, request);
    return request;
  }

  public async approve(id: string, user: string): Promise<ConfirmationRequest> {
    const request = this.requests.get(id);
    if (!request) {
      throw new Error(`Requisição de confirmação não encontrada: ${id}`);
    }

    if (Date.now() > request.expiresAt) {
      request.status = "expired";
      throw new Error(`Requisição de confirmação expirada: ${id}`);
    }

    if (request.status !== "pending") {
      throw new Error(`Requisição de confirmação já finalizada com status: ${request.status}`);
    }

    request.status = "approved";
    request.resolvedAt = Date.now();
    request.resolvedBy = user;
    return request;
  }

  public async reject(id: string, user: string, reason?: string): Promise<ConfirmationRequest> {
    const request = this.requests.get(id);
    if (!request) {
      throw new Error(`Requisição de confirmação não encontrada: ${id}`);
    }

    request.status = "rejected";
    request.resolvedAt = Date.now();
    request.resolvedBy = user;
    request.reason = reason;
    return request;
  }

  public consume(id: string, user = "unknown"): boolean {
    const request = this.requests.get(id);
    if (!request) return false;
    if (request.status !== "approved") return false;
    if (Date.now() > request.expiresAt) {
      request.status = "expired";
      return false;
    }
    request.status = "consumed";
    request.resolvedAt = Date.now();
    request.resolvedBy = user;
    return true;
  }

  public get(id: string): ConfirmationRequest | undefined {
    const request = this.requests.get(id);
    if (!request) return undefined;

    if (request.status === "pending" && Date.now() > request.expiresAt) {
      request.status = "expired";
    }

    return request;
  }

  public listPending(): ConfirmationRequest[] {
    const now = Date.now();
    const pending: ConfirmationRequest[] = [];

    for (const req of this.requests.values()) {
      if (req.status === "pending") {
        if (now > req.expiresAt) {
          req.status = "expired";
        } else {
          pending.push(req);
        }
      }
    }

    return pending;
  }

  public cleanExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, req] of Array.from(this.requests.entries())) {
      if (req.status === "expired" || (req.status === "pending" && now > req.expiresAt)) {
        this.requests.delete(id);
        count++;
      }
    }
    return count;
  }

  public clear(): void {
    this.requests.clear();
  }
}

export const approvalManager = new ApprovalManager();
