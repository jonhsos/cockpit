import {
  type PaneState,
  type PaneStatus,
  normalizePaneStatus,
  transitionPane,
} from "./pane-state.ts";
import { hasSignificantTerminalOutput } from "./terminal-activity.ts";

export const DEFAULT_SPARKLINE_SLOTS = 40;
export const DEFAULT_IDLE_TIMEOUT_MS = 700;

/**
 * Tracks activity metrics, byte counters, and idle intervals for a single pane.
 */
export class PaneActivityTracker {
  public readonly paneId: string;
  public bytesIn: number = 0;
  public bytesOut: number = 0;
  public lastData: number = Date.now();
  public acumulado: number = 0;
  public readonly slots: number;
  public readonly idleTimeoutMs: number;

  constructor(paneId: string, slots: number = DEFAULT_SPARKLINE_SLOTS, idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS) {
    this.paneId = paneId;
    this.slots = slots;
    this.idleTimeoutMs = idleTimeoutMs;
  }

  /**
   * Initializes a 40-slot sparkline activity array.
   */
  public static createInitialSparkline(slots: number = DEFAULT_SPARKLINE_SLOTS): number[] {
    return new Array<number>(slots).fill(0);
  }

  /**
   * Records incoming user / client keystrokes / input.
   */
  public recordInput(bytes: number, state?: PaneState): void {
    this.bytesIn += bytes;
    if (state) {
      state.bytesIn = this.bytesIn;
      state.atualizadoEm = Date.now();
    }
  }

  /**
   * Records outgoing terminal stream bytes.
   * ANSI / keepalive-only chunks update byte counters but do not count as work.
   */
  public recordOutput(data: string | number, state?: PaneState): void {
    const now = Date.now();
    const bytes = typeof data === "number" ? data : data.length;
    const significant = typeof data === "number" ? bytes > 0 : hasSignificantTerminalOutput(data);

    this.bytesOut += bytes;
    if (significant) {
      this.lastData = now;
      this.acumulado += bytes;
    }

    if (state) {
      state.bytesOut = this.bytesOut;
      state.atualizadoEm = now;

      if (significant) {
        const currentNorm = normalizePaneStatus(state.status);
        if (currentNorm === "starting" || currentNorm === "waiting-user") {
          try {
            transitionPane(state, "working");
          } catch {
            // Best effort if in restricted state
          }
        }
      }
    }
  }

  /**
   * Evaluates a 1-second pulse tick:
   * 1. Slides the 40-slot sparkline array with current accumulated bytes.
   * 2. Checks idle timeout to transition "working" -> "waiting-user".
   */
  public tick(
    state: PaneState,
    now: number = Date.now(),
  ): {
    paneId: string;
    status: PaneStatus;
    atividade: number[];
    bytesIn: number;
    bytesOut: number;
    changed: boolean;
  } {
    // Ensure atividade array has correct length
    if (!state.atividade || state.atividade.length !== this.slots) {
      state.atividade = new Array<number>(this.slots).fill(0);
    }

    // Slide window
    state.atividade.push(this.acumulado);
    if (state.atividade.length > this.slots) {
      state.atividade.shift();
    }
    this.acumulado = 0;

    const previousStatus = state.status;
    const currentNorm = normalizePaneStatus(state.status);
    const isIdle = now - this.lastData > this.idleTimeoutMs;

    // Automatic transition between working and waiting-user based on idle threshold
    if ((currentNorm === "working" || currentNorm === "starting") && isIdle) {
      try {
        transitionPane(state, "waiting-user");
      } catch {
        // Leave intact if prevented
      }
    } else if (currentNorm === "waiting-user" && !isIdle && this.bytesOut > 0) {
      try {
        transitionPane(state, "working");
      } catch {
        // Leave intact
      }
    }

    return {
      paneId: this.paneId,
      status: state.status,
      atividade: [...state.atividade],
      bytesIn: this.bytesIn,
      bytesOut: this.bytesOut,
      changed: state.status !== previousStatus,
    };
  }
}
