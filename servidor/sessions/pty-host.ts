import net from "node:net";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { spawn as ptySpawn, type IPty } from "node-pty";
import {
  type PaneState,
  type PaneStatus,
  normalizePaneStatus,
  transitionPane,
} from "./pane-state.ts";
import { PaneActivityTracker, DEFAULT_SPARKLINE_SLOTS } from "./tracker.ts";

export const DEFAULT_RING_BUFFER_CAPACITY = 256 * 1024; // 256 KB per pane

/**
 * High-performance circular ring buffer for terminal output.
 * Preserves the most recent 256 KB of output for seamless UI scrollback replay.
 */
export class RingBuffer {
  private buffer: Buffer;
  public readonly capacity: number;
  private writePos: number = 0;
  private totalBytes: number = 0;

  constructor(capacity: number = DEFAULT_RING_BUFFER_CAPACITY) {
    this.capacity = capacity;
    this.buffer = Buffer.alloc(capacity);
  }

  public write(chunk: string | Buffer): void {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    if (bytes.length === 0) return;

    if (bytes.length >= this.capacity) {
      // Chunk exceeds total capacity: keep only the most recent `capacity` bytes
      const slice = bytes.subarray(bytes.length - this.capacity);
      slice.copy(this.buffer, 0);
      this.writePos = 0;
      this.totalBytes += bytes.length;
      return;
    }

    const remaining = this.capacity - this.writePos;
    if (bytes.length <= remaining) {
      bytes.copy(this.buffer, this.writePos);
      this.writePos = (this.writePos + bytes.length) % this.capacity;
    } else {
      bytes.copy(this.buffer, this.writePos, 0, remaining);
      const secondPart = bytes.length - remaining;
      bytes.copy(this.buffer, 0, remaining, remaining + secondPart);
      this.writePos = secondPart;
    }
    this.totalBytes += bytes.length;
  }

  public getSnapshot(): Buffer {
    if (this.totalBytes <= this.capacity) {
      return Buffer.from(this.buffer.subarray(0, this.totalBytes));
    }
    const tail = this.buffer.subarray(this.writePos, this.capacity);
    const head = this.buffer.subarray(0, this.writePos);
    return Buffer.concat([tail, head]);
  }

  public getSnapshotString(): string {
    return this.getSnapshot().toString("utf8");
  }

  public clear(): void {
    this.writePos = 0;
    this.totalBytes = 0;
    this.buffer.fill(0);
  }

  public get size(): number {
    return Math.min(this.totalBytes, this.capacity);
  }

  public get totalWritten(): number {
    return this.totalBytes;
  }
}

export function getDefaultSocketPath(): string {
  if (process.env.COCKPIT_PTY_SOCKET) {
    return process.env.COCKPIT_PTY_SOCKET;
  }
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\cockpit-pty-daemon";
  }
  const home = process.env.COCKPIT_HOME || join(homedir(), ".cockpit");
  if (!existsSync(home)) {
    try {
      mkdirSync(home, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }
  return join(home, "pty-daemon.sock");
}

export interface DaemonSpawnOptions {
  paneId: string;
  file: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  initialState: {
    agent: string;
    label: string;
    cor: string;
    cli: string;
    role?: string;
    runner?: string;
    model: string | null;
    effort: string | null;
    tipo: string | null;
    projectId: string | null;
    missionId: string | null;
    sessionId: string | null;
    maestro: boolean;
    backend?: "pty" | "dsh";
  };
}

interface HostPaneEntry {
  paneId: string;
  pty: IPty;
  state: PaneState;
  ringBuffer: RingBuffer;
  tracker: PaneActivityTracker;
}

export class PtyHost {
  public readonly socketPath: string;
  private server: net.Server | null = null;
  private entries = new Map<string, HostPaneEntry>();
  private clients = new Set<net.Socket>();
  private pulseTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(socketPath: string = getDefaultSocketPath()) {
    this.socketPath = socketPath;
  }

  public async start(): Promise<void> {
    // If socket file exists on unix, verify if it's dead
    if (process.platform !== "win32" && existsSync(this.socketPath)) {
      const isAlive = await this.probeSocket(this.socketPath);
      if (isAlive) {
        throw new Error(`PTY Host daemon is already running on ${this.socketPath}`);
      }
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Ignored
      }
    }

    const socketDir = dirname(this.socketPath);
    if (process.platform !== "win32" && !existsSync(socketDir)) {
      mkdirSync(socketDir, { recursive: true });
    }

    return new Promise<void>((resolve, reject) => {
      this.server = net.createServer((client) => this.handleClientConnection(client));

      this.server.on("error", (err) => {
        if (!this.isShuttingDown) {
          reject(err);
        }
      });

      this.server.listen(this.socketPath, () => {
        // Start 1-second pulse ticker
        this.pulseTimer = setInterval(() => this.pulseTick(), 1000);
        resolve();
      });
    });
  }

  private probeSocket(path: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const s = net.connect(path, () => {
        s.end();
        resolve(true);
      });
      s.on("error", () => resolve(false));
      setTimeout(() => {
        s.destroy();
        resolve(false);
      }, 500);
    });
  }

  private handleClientConnection(client: net.Socket): void {
    this.clients.add(client);
    let buffer = "";

    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          try {
            const msg = JSON.parse(line);
            this.handleClientMessage(client, msg);
          } catch (e: any) {
            this.sendToClient(client, { type: "error", error: `Invalid JSON: ${e.message}` });
          }
        }
      }
    });

    client.on("close", () => {
      this.clients.delete(client);
    });

    client.on("error", () => {
      this.clients.delete(client);
    });
  }

  private handleClientMessage(client: net.Socket, msg: any): void {
    const { type, reqId } = msg;

    switch (type) {
      case "ping":
        this.sendToClient(client, { type: "pong", reqId, timestamp: Date.now() });
        break;

      case "spawn":
        this.handleSpawn(client, reqId, msg.opts);
        break;

      case "input":
        this.handleInput(client, msg.paneId, msg.data, reqId);
        break;

      case "resize":
        this.handleResize(client, msg.paneId, msg.cols, msg.rows, reqId);
        break;

      case "kill":
        this.handleKill(client, msg.paneId, reqId);
        break;

      case "list":
        this.handleList(client, reqId);
        break;

      case "replay":
        this.handleReplay(client, reqId, msg.paneId);
        break;

      case "attach":
        // Client is attached; respond with current pane list
        this.handleList(client, reqId);
        break;

      case "override_status":
        this.handleStatusOverride(client, msg.paneId, msg.status, msg.reason, reqId);
        break;

      case "shutdown":
        this.sendToClient(client, { type: "shutdown_ack", reqId });
        this.stop();
        break;

      default:
        this.sendToClient(client, { type: "error", reqId, error: `Unknown message type: ${type}` });
        break;
    }
  }

  private handleSpawn(client: net.Socket, reqId: string, opts: DaemonSpawnOptions): void {
    try {
      const { paneId, file, args, cwd, env, cols, rows, initialState } = opts;

      if (this.entries.has(paneId)) {
        throw new Error(`Pane with id "${paneId}" already exists`);
      }

      const spawnEnv: NodeJS.ProcessEnv = {
        ...(env ? { ...env } : { ...process.env }),
        TERM: "xterm-256color",
      };
      for (const k of Object.keys(spawnEnv)) {
        if (k.toLowerCase().startsWith("npm_")) {
          delete spawnEnv[k];
        }
      }

      const pty = ptySpawn(file, args, {
        name: "xterm-256color",
        cols: cols ?? 80,
        rows: rows ?? 24,
        cwd,
        env: spawnEnv as Record<string, string>,
      });

      const ringBuffer = new RingBuffer(DEFAULT_RING_BUFFER_CAPACITY);
      const tracker = new PaneActivityTracker(paneId, DEFAULT_SPARKLINE_SLOTS);

      const state: PaneState = {
        paneId,
        agent: initialState.agent,
        label: initialState.label,
        cor: initialState.cor,
        cli: initialState.cli,
        role: initialState.role,
        runner: initialState.runner,
        model: initialState.model,
        effort: initialState.effort,
        tipo: initialState.tipo,
        cwd,
        projectId: initialState.projectId,
        missionId: initialState.missionId,
        sessionId: initialState.sessionId,
        maestro: initialState.maestro,
        backend: initialState.backend ?? "pty",
        status: "starting",
        bytesIn: 0,
        bytesOut: 0,
        iniciadoEm: Date.now(),
        atualizadoEm: Date.now(),
        atividade: PaneActivityTracker.createInitialSparkline(DEFAULT_SPARKLINE_SLOTS),
      };

      const entry: HostPaneEntry = { paneId, pty, state, ringBuffer, tracker };
      this.entries.set(paneId, entry);

      // Listen to PTY data
      pty.onData((data: string) => {
        ringBuffer.write(data);
        tracker.recordOutput(data.length, state);
        this.broadcast({ type: "output", paneId, data });
      });

      // Listen to PTY exit
      pty.onExit(({ exitCode }) => {
        const finalStatus = exitCode === 0 ? "dead" : "failed";
        try {
          transitionPane(state, finalStatus, { exitCode });
        } catch {
          state.status = finalStatus;
          state.exitCode = exitCode;
        }

        this.broadcast({
          type: "exit",
          paneId,
          code: exitCode,
          status: state.status,
        });
      });

      this.sendToClient(client, { type: "spawned", reqId, pane: state, pid: pty.pid });
    } catch (err: any) {
      this.sendToClient(client, { type: "spawned", reqId, error: err.message });
    }
  }

  private handleInput(client: net.Socket, paneId: string, data: string, reqId?: string): void {
    const entry = this.entries.get(paneId);
    if (!entry || entry.state.status === "dead") {
      if (reqId) this.sendToClient(client, { type: "error", reqId, error: `Pane "${paneId}" not found or dead` });
      return;
    }

    try {
      entry.pty.write(data);
      entry.tracker.recordInput(data.length, entry.state);
      if (reqId) this.sendToClient(client, { type: "input_ack", reqId, paneId });
    } catch (err: any) {
      if (reqId) this.sendToClient(client, { type: "error", reqId, error: err.message });
    }
  }

  private handleResize(client: net.Socket, paneId: string, cols: number, rows: number, reqId?: string): void {
    const entry = this.entries.get(paneId);
    if (!entry || entry.state.status === "dead") {
      if (reqId) this.sendToClient(client, { type: "error", reqId, error: `Pane "${paneId}" not found or dead` });
      return;
    }

    try {
      entry.pty.resize(cols, rows);
      if (reqId) this.sendToClient(client, { type: "resize_ack", reqId, paneId });
    } catch (err: any) {
      if (reqId) this.sendToClient(client, { type: "error", reqId, error: err.message });
    }
  }

  private handleKill(client: net.Socket, paneId: string, reqId?: string): void {
    const entry = this.entries.get(paneId);
    if (!entry) {
      if (reqId) this.sendToClient(client, { type: "error", reqId, error: `Pane "${paneId}" not found` });
      return;
    }

    try {
      if (process.platform === "win32") {
        execFile("taskkill", ["/pid", String(entry.pty.pid), "/T", "/F"], () => {});
      } else {
        entry.pty.kill();
      }
      entry.state.status = "dead";
      this.entries.delete(paneId);
      if (reqId) this.sendToClient(client, { type: "kill_ack", reqId, paneId });
      this.broadcast({ type: "exit", paneId, code: 0, status: "dead" });
    } catch (err: any) {
      if (reqId) this.sendToClient(client, { type: "error", reqId, error: err.message });
    }
  }

  private handleList(client: net.Socket, reqId: string): void {
    const panes = Array.from(this.entries.values()).map((e) => e.state);
    this.sendToClient(client, { type: "list_res", reqId, panes });
  }

  private handleReplay(client: net.Socket, reqId: string, paneId: string): void {
    const entry = this.entries.get(paneId);
    if (!entry) {
      this.sendToClient(client, { type: "error", reqId, error: `Pane "${paneId}" not found` });
      return;
    }

    const scrollback = entry.ringBuffer.getSnapshotString();
    this.sendToClient(client, {
      type: "replay_res",
      reqId,
      paneId,
      scrollback,
      totalBytes: entry.ringBuffer.totalWritten,
    });
  }

  private handleStatusOverride(
    client: net.Socket,
    paneId: string,
    status: PaneStatus,
    reason?: string,
    reqId?: string,
  ): void {
    const entry = this.entries.get(paneId);
    if (!entry) {
      if (reqId) this.sendToClient(client, { type: "error", reqId, error: `Pane "${paneId}" not found` });
      return;
    }

    try {
      transitionPane(entry.state, status, { reason });
      this.broadcast({
        type: "status_update",
        paneId,
        status: entry.state.status,
        blockedReason: entry.state.blockedReason,
      });
      if (reqId) this.sendToClient(client, { type: "override_ack", reqId, paneId, status: entry.state.status });
    } catch (err: any) {
      if (reqId) this.sendToClient(client, { type: "error", reqId, error: err.message });
    }
  }

  private pulseTick(): void {
    if (this.entries.size === 0 || this.clients.size === 0) return;

    const pulses: Array<{
      paneId: string;
      status: PaneStatus;
      atividade: number[];
      bytesIn: number;
      bytesOut: number;
    }> = [];

    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.state.status !== "dead") {
        const pulse = entry.tracker.tick(entry.state, now);
        pulses.push(pulse);
      }
    }

    if (pulses.length > 0) {
      this.broadcast({
        type: "pulse",
        timestamp: now,
        pulses,
      });
    }
  }

  public getPane(paneId: string): PaneState | undefined {
    return this.entries.get(paneId)?.state;
  }

  public listPanes(): PaneState[] {
    return Array.from(this.entries.values()).map((e) => e.state);
  }

  public getRingBuffer(paneId: string): RingBuffer | undefined {
    return this.entries.get(paneId)?.ringBuffer;
  }

  private sendToClient(client: net.Socket, data: any): void {
    if (!client.destroyed && client.writable) {
      client.write(JSON.stringify(data) + "\n");
    }
  }

  private broadcast(data: any): void {
    const payload = JSON.stringify(data) + "\n";
    for (const client of this.clients) {
      if (!client.destroyed && client.writable) {
        client.write(payload);
      }
    }
  }

  public async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }

    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    if (process.platform !== "win32" && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Ignored
      }
    }
  }
}

// If executed directly from CLI: start standalone daemon
if (process.argv[1] && process.argv[1].endsWith("pty-host.ts")) {
  const host = new PtyHost();
  host
    .start()
    .then(() => {
      // Keep alive
    })
    .catch((err) => {
      console.error("Failed to start PTY Host daemon:", err);
      process.exit(1);
    });

  process.on("SIGTERM", () => host.stop().then(() => process.exit(0)));
  process.on("SIGINT", () => host.stop().then(() => process.exit(0)));
}
