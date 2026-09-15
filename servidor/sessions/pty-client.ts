import net from "node:net";
import { EventEmitter } from "node:events";
import { existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn as childSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  getDefaultSocketPath,
  type DaemonSpawnOptions,
} from "./pty-host.ts";
import { type PaneState, type PaneStatus } from "./pane-state.ts";

export interface PtyClientEvents {
  output: (paneId: string, data: string) => void;
  exit: (paneId: string, code: number, status: PaneStatus) => void;
  status_update: (paneId: string, status: PaneStatus, blockedReason?: string | null) => void;
  pulse: (pulses: Array<{ paneId: string; status: PaneStatus; atividade: number[]; bytesIn: number; bytesOut: number }>) => void;
  connected: () => void;
  disconnected: () => void;
}

export class PtyClient extends EventEmitter {
  public readonly socketPath: string;
  private socket: net.Socket | null = null;
  private isConnected: boolean = false;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }
  >();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldAutoReconnect: boolean = true;
  private incomingBuffer: string = "";

  constructor(socketPath: string = getDefaultSocketPath()) {
    super();
    this.socketPath = socketPath;
  }

  /**
   * Probes if daemon is already accepting connections.
   */
  private async testConnect(path: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const s = net.connect(path, () => {
        s.end();
        resolve(true);
      });
      s.on("error", (err) => reject(err));
      setTimeout(() => {
        s.destroy();
        reject(new Error("Connection probe timeout"));
      }, 400);
    });
  }

  /**
   * Ensures the detached PTY host daemon is running.
   * If not active, auto-spawns it detached (child.unref()) and awaits socket readiness.
   */
  public async ensureHost(): Promise<void> {
    try {
      await this.testConnect(this.socketPath);
      return;
    } catch {
      // Daemon not reachable
    }

    if (process.platform !== "win32" && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Best effort
      }
    }

    const hostScript = fileURLToPath(new URL("./pty-host.ts", import.meta.url));
    const child = childSpawn(process.execPath, [hostScript], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        COCKPIT_PTY_SOCKET: this.socketPath,
      },
    });
    child.unref();

    const startTime = Date.now();
    let connected = false;
    while (Date.now() - startTime < 6000) {
      try {
        await this.testConnect(this.socketPath);
        connected = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }

    if (!connected) {
      throw new Error(`Failed to initialize PTY Host daemon at "${this.socketPath}" within timeout`);
    }
  }

  /**
   * Connects to the running PTY Host daemon via Unix Domain Socket.
   */
  public async connect(): Promise<void> {
    if (this.isConnected && this.socket && !this.socket.destroyed) {
      return;
    }

    await this.ensureHost();

    return new Promise<void>((resolve, reject) => {
      this.socket = net.connect(this.socketPath, () => {
        this.isConnected = true;
        this.emit("connected");
        // Attach to receive streaming events
        this.sendRaw({ type: "attach", reqId: randomUUID() });
        resolve();
      });

      this.socket.on("data", (chunk) => this.handleData(chunk));

      this.socket.on("close", () => {
        this.isConnected = false;
        this.socket = null;
        this.emit("disconnected");
        this.rejectAllPending(new Error("Socket closed"));
        if (this.shouldAutoReconnect) {
          this.scheduleReconnect();
        }
      });

      this.socket.on("error", (err) => {
        if (!this.isConnected) {
          reject(err);
        }
      });
    });
  }

  private handleData(chunk: Buffer): void {
    this.incomingBuffer += chunk.toString("utf8");
    let newlineIdx: number;
    while ((newlineIdx = this.incomingBuffer.indexOf("\n")) !== -1) {
      const line = this.incomingBuffer.slice(0, newlineIdx).trim();
      this.incomingBuffer = this.incomingBuffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch {
          // Ignore malformed line
        }
      }
    }
  }

  private handleMessage(msg: any): void {
    const { type, reqId } = msg;

    // Check if message resolves a pending request
    if (reqId && this.pendingRequests.has(reqId)) {
      const pending = this.pendingRequests.get(reqId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(reqId);

      if (type === "error") {
        pending.reject(new Error(msg.error || "IPC Error"));
        return;
      }
      pending.resolve(msg);
    }

    // Handle broadcast events
    switch (type) {
      case "output":
        this.emit("output", msg.paneId, msg.data);
        break;
      case "exit":
        this.emit("exit", msg.paneId, msg.code, msg.status);
        break;
      case "status_update":
        this.emit("status_update", msg.paneId, msg.status, msg.blockedReason);
        break;
      case "pulse":
        this.emit("pulse", msg.pulses);
        break;
    }
  }

  private sendRaw(data: any): void {
    if (this.socket && !this.socket.destroyed && this.socket.writable) {
      this.socket.write(JSON.stringify(data) + "\n");
    }
  }

  private request<T = any>(data: any, timeoutMs: number = 8000): Promise<T> {
    if (!this.isConnected || !this.socket) {
      return Promise.reject(new Error("PtyClient is not connected to daemon"));
    }

    const reqId = data.reqId || randomUUID();
    data.reqId = reqId;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`IPC Request timeout (${data.type})`));
        }
      }, timeoutMs);

      this.pendingRequests.set(reqId, { resolve, reject, timer });
      this.sendRaw(data);
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [reqId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        if (this.shouldAutoReconnect) {
          this.scheduleReconnect();
        }
      }
    }, 1000);
  }

  /**
   * Pings the PTY daemon to verify IPC connectivity.
   */
  public async ping(): Promise<string> {
    const res = await this.request({ type: "ping" });
    return res.type === "pong" ? "pong" : "";
  }

  /**
   * Spawns a process managed by the PTY daemon.
   */
  public async spawn(opts: DaemonSpawnOptions): Promise<PaneState & { pid?: number }> {
    const res = await this.request({ type: "spawn", opts });
    if (res.error) {
      throw new Error(res.error);
    }
    const pane = res.pane as PaneState & { pid?: number };
    if (res.pid && pane) {
      pane.pid = res.pid;
    }
    return pane;
  }

  /**
   * Sends user / client input to the master PTY descriptor.
   */
  public async input(paneId: string, data: string): Promise<void> {
    // Input is high-frequency; send without waiting for ack unless needed
    this.sendRaw({ type: "input", paneId, data });
  }

  /**
   * Resizes the master PTY window dimensions.
   */
  public async resize(paneId: string, cols: number, rows: number): Promise<void> {
    this.sendRaw({ type: "resize", paneId, cols, rows });
  }

  /**
   * Terminates the pane and child process tree.
   */
  public async kill(paneId: string): Promise<void> {
    await this.request({ type: "kill", paneId });
  }

  /**
   * Lists all surviving panes from the daemon.
   */
  public async list(): Promise<PaneState[]> {
    const res = await this.request({ type: "list" });
    return res.panes || [];
  }

  /**
   * Replays the circular ring buffer output (up to 256KB) for a pane.
   */
  public async replay(paneId: string): Promise<string> {
    const res = await this.request({ type: "replay", paneId });
    return res.scrollback || "";
  }

  /**
   * Overrides pane status (e.g. for blocking, review, completion).
   */
  public async overrideStatus(paneId: string, status: PaneStatus, reason?: string): Promise<void> {
    await this.request({ type: "override_status", paneId, status, reason });
  }

  /**
   * Disconnects from the daemon.
   * Note: This does NOT terminate the PTY processes running in the daemon.
   */
  public disconnect(): void {
    this.shouldAutoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
  }

  public get connected(): boolean {
    return this.isConnected;
  }
}
