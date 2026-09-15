import type { MissionStore } from "../persistence/mission-store.ts";
import type { MissionMode } from "../persistence/types.ts";
import { auditLogger } from "../security/audit.ts";

export type { MissionMode };

export const DEFAULT_MAX_AUTONOMOUS_PANES = 4;

export function normalizeMissionMode(mode: unknown): MissionMode {
  if (typeof mode === "string") {
    const m = mode.trim().toLowerCase();
    if (m === "dirigido") return "dirigido";
    if (m === "autonomo" || m === "autônomo") return "autonomo";
  }
  return "livre";
}

export interface AutoSpawnGuardParams {
  mode: MissionMode;
  currentPanes: number;
  maxPanes?: number;
  emergencyHalt?: boolean;
}

export interface DelegateGuardParams {
  mode: MissionMode;
  targetAgentOrRole: string;
  authorizedRoles?: string[];
  emergencyHalt?: boolean;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export function canMaestroAutoSpawn(params: AutoSpawnGuardParams): GuardResult {
  if (params.emergencyHalt) {
    return { allowed: false, reason: "Parada de emergência ativa. Ações autônomas bloqueadas." };
  }

  if (params.mode === "livre") {
    return {
      allowed: false,
      reason: "Ações autônomas desativadas no modo Livre. Controle 100% manual do usuário.",
    };
  }

  if (params.mode === "dirigido") {
    return {
      allowed: false,
      reason: "Modo Dirigido não permite criação autônoma de novos painéis pelo Maestro.",
    };
  }

  if (params.mode === "autonomo") {
    const max = params.maxPanes ?? DEFAULT_MAX_AUTONOMOUS_PANES;
    if (params.currentPanes >= max) {
      return {
        allowed: false,
        reason: `Limite de concorrência de painéis atingido (máximo ${max} painéis no modo Autônomo).`,
      };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: "Modo de missão desconhecido." };
}

export function canMaestroDelegate(params: DelegateGuardParams): GuardResult {
  if (params.emergencyHalt) {
    return { allowed: false, reason: "Parada de emergência ativa. Delegações bloqueadas." };
  }

  if (params.mode === "livre") {
    return {
      allowed: false,
      reason: "Delegação autônoma desativada no modo Livre.",
    };
  }

  if (params.mode === "dirigido") {
    const roles = (params.authorizedRoles ?? []).map((r) => r.toLowerCase());
    if (roles.length > 0 && !roles.includes(params.targetAgentOrRole.toLowerCase())) {
      return {
        allowed: false,
        reason: `Agente ou papel "${params.targetAgentOrRole}" não autorizado no elenco do modo Dirigido.`,
      };
    }
    return { allowed: true };
  }

  if (params.mode === "autonomo") {
    return { allowed: true };
  }

  return { allowed: false, reason: "Modo de missão desconhecido." };
}

export class MissionModeManager {
  private missionStore?: MissionStore;
  // missionId -> emergencyHalt
  private emergencyHalts: Map<string, boolean> = new Map();
  // missionId -> maxPanes override
  private maxPanesOverrides: Map<string, number> = new Map();

  constructor(missionStore?: MissionStore) {
    this.missionStore = missionStore;
  }

  public getMissionMode(
    missionId: string,
    fallbackMode: MissionMode = "livre",
  ): { modo: MissionMode; emergencyHalt: boolean; maxPanes: number } {
    let mode = fallbackMode;
    if (this.missionStore) {
      const record = this.missionStore.getMission(missionId);
      if (record?.modo) {
        mode = normalizeMissionMode(record.modo);
      }
    }
    const emergencyHalt = this.emergencyHalts.get(missionId) ?? false;
    const maxPanes = this.maxPanesOverrides.get(missionId) ?? DEFAULT_MAX_AUTONOMOUS_PANES;

    return { modo: mode, emergencyHalt, maxPanes };
  }

  public setMissionMode(missionId: string, rawMode: unknown): MissionMode {
    const modo = normalizeMissionMode(rawMode);
    if (this.missionStore) {
      const record = this.missionStore.getMission(missionId);
      if (record) {
        record.modo = modo;
        this.missionStore.saveMission(record);
      }
    }

    auditLogger.logAction("mission_mode_changed", { type: "user", id: "user" }, { modo }, { missionId });
    return modo;
  }

  public setMaxPanes(missionId: string, max: number): void {
    this.maxPanesOverrides.set(missionId, max);
  }

  public emergencyStop(missionId: string): boolean {
    this.emergencyHalts.set(missionId, true);
    auditLogger.logAction("emergency_stop_triggered", { type: "user", id: "user" }, { halted: true }, { missionId });
    return true;
  }

  public resumeMission(missionId: string): boolean {
    this.emergencyHalts.set(missionId, false);
    auditLogger.logAction("emergency_stop_resumed", { type: "user", id: "user" }, { halted: false }, { missionId });
    return true;
  }

  public isHalted(missionId: string): boolean {
    return this.emergencyHalts.get(missionId) ?? false;
  }
}
