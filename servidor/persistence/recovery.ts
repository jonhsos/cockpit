import type { DiskStore } from "./disk-store.ts";
import { MissionStore } from "./mission-store.ts";
import { PaneStore } from "./pane-store.ts";
import { TaskStore } from "./task-store.ts";
import { OwnershipStore } from "./ownership-store.ts";
import { HistoryStore } from "./history-store.ts";
import { runMigrationIfNeeded } from "./migration.ts";

export interface RecoveryReport {
  projectsRecovered: number;
  missionsRecovered: number;
  panesRecovered: number;
  tasksRecovered: number;
  activeLocksRecovered: number;
  orphansCleaned: boolean;
}

export function recoverOnBoot(disk: DiskStore): RecoveryReport {
  // Step 1: Clean up orphan temporary files from prior crashes
  disk.cleanOrphanTmpFiles(disk.getBaseDir());

  // Step 2: Ensure schema migrations are applied
  runMigrationIfNeeded(disk);

  // Step 3: Instantiate stores
  const missionStore = new MissionStore(disk);
  const paneStore = new PaneStore(disk);
  const taskStore = new TaskStore(disk);
  const ownershipStore = new OwnershipStore(disk);
  const historyStore = new HistoryStore(disk);

  const projects = missionStore.listProjects();
  const missions = missionStore.listMissions();

  let totalPanes = 0;
  let totalTasks = 0;
  let totalLocks = 0;

  for (const mission of missions) {
    const panes = paneStore.listPanes(mission.id);
    totalPanes += panes.length;

    // Missões guardam somente panes recuperáveis. Registros mortos continuam
    // disponíveis no histórico em disco, mas não reaparecem na interface.
    const activePaneIds = panes
      .filter((p) => !["dead", "completed", "failed"].includes(p.status))
      .map((p) => p.paneId);
    if (JSON.stringify(mission.panes) !== JSON.stringify(activePaneIds)) {
      mission.panes = activePaneIds;
      missionStore.saveMission(mission);
    }

    const tasks = taskStore.listTasks(mission.id);
    totalTasks += tasks.length;

    // Check ownership locks integrity
    const ownership = ownershipStore.getOwnershipState(mission.id);
    const activeLocks = Object.values(ownership.locks);
    totalLocks += activeLocks.length;
  }

  // Step 4: Record audit log for server boot
  historyStore.appendAudit({
    actor: "system",
    action: "server:boot",
    details: {
      projectsCount: projects.length,
      missionsCount: missions.length,
      panesCount: totalPanes,
      tasksCount: totalTasks,
      locksCount: totalLocks,
    },
  });

  return {
    projectsRecovered: projects.length,
    missionsRecovered: missions.length,
    panesRecovered: totalPanes,
    tasksRecovered: totalTasks,
    activeLocksRecovered: totalLocks,
    orphansCleaned: true,
  };
}
