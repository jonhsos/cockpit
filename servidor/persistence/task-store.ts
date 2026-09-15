import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DiskStore } from "./disk-store.ts";
import type { Task, TaskStatus } from "./types.ts";

export class TaskStore {
  private disk: DiskStore;

  constructor(disk: DiskStore) {
    this.disk = disk;
  }

  private tasksFile(missionId: string): string {
    return join(this.disk.getBaseDir(), "missions", missionId, "tasks.json");
  }

  public listTasks(
    missionId?: string,
    filter?: { status?: TaskStatus; papel?: string; pane?: string }
  ): Task[] {
    let allTasks: Task[] = [];

    if (missionId) {
      const file = this.tasksFile(missionId);
      allTasks = this.disk.readJson<Task[]>(file, []);
    } else {
      const missionsDir = join(this.disk.getBaseDir(), "missions");
      if (existsSync(missionsDir)) {
        const dirs = readdirSync(missionsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
        for (const id of dirs) {
          const file = this.tasksFile(id);
          const tasks = this.disk.readJson<Task[]>(file, []);
          allTasks.push(...tasks);
        }
      }
    }

    if (!filter) return allTasks;

    return allTasks.filter((t) => {
      if (filter.status && t.status !== filter.status) return false;
      if (filter.papel && t.papel !== filter.papel) return false;
      if (filter.pane && t.pane !== filter.pane) return false;
      return true;
    });
  }

  public getTask(taskId: string, missionId?: string): Task | undefined {
    const tasks = this.listTasks(missionId);
    return tasks.find((t) => t.id === taskId);
  }

  public saveTask(task: Task): void {
    if (!task.missionId) {
      throw new Error(`Não é possível salvar tarefa ${task.id} sem missionId`);
    }
    const file = this.tasksFile(task.missionId);
    const tasks = this.disk.readJson<Task[]>(file, []);
    const idx = tasks.findIndex((t) => t.id === task.id);
    task.timestamps.atualizadaEm = Date.now();
    if (idx >= 0) {
      tasks[idx] = task;
    } else {
      tasks.push(task);
    }
    this.disk.writeJsonAtomic(file, tasks);
  }

  public deleteTask(taskId: string, missionId?: string): boolean {
    if (missionId) {
      const file = this.tasksFile(missionId);
      const tasks = this.disk.readJson<Task[]>(file, []);
      const filtered = tasks.filter((t) => t.id !== taskId);
      if (filtered.length !== tasks.length) {
        this.disk.writeJsonAtomic(file, filtered);
        return true;
      }
      return false;
    }

    // Search across all missions
    const missionsDir = join(this.disk.getBaseDir(), "missions");
    if (!existsSync(missionsDir)) return false;
    const dirs = readdirSync(missionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const id of dirs) {
      const file = this.tasksFile(id);
      const tasks = this.disk.readJson<Task[]>(file, []);
      const filtered = tasks.filter((t) => t.id !== taskId);
      if (filtered.length !== tasks.length) {
        this.disk.writeJsonAtomic(file, filtered);
        return true;
      }
    }
    return false;
  }

  public clear(missionId?: string): void {
    if (missionId) {
      this.disk.writeJsonAtomic(this.tasksFile(missionId), []);
      return;
    }
    const missionsDir = join(this.disk.getBaseDir(), "missions");
    if (!existsSync(missionsDir)) return;
    const dirs = readdirSync(missionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const id of dirs) {
      this.disk.writeJsonAtomic(this.tasksFile(id), []);
    }
  }
}
