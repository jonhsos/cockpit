import { Router } from "express";
import type { TaskManager } from "./task-manager.ts";
import type { FileOwnershipManager } from "./file-ownership.ts";
import {
  InvalidTaskStateTransitionError,
  UnmetTaskDependencyError,
} from "./task-state-machine.ts";

export function criarTaskRoutes(
  taskManager: TaskManager,
  ownershipManager: FileOwnershipManager
): Router {
  const router = Router();

  // List all tasks for a mission
  router.get("/missions/:missionId/tasks", (req, res) => {
    try {
      const tasks = taskManager.listTasks(req.params.missionId);
      res.json({ ok: true, tasks });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Get interactive sidebar task board
  router.get("/missions/:missionId/tasks/board", (req, res) => {
    try {
      const board = taskManager.getBoard(req.params.missionId);
      res.json({ ok: true, board });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Create a new task (13 fields)
  router.post("/missions/:missionId/tasks", (req, res) => {
    try {
      const task = taskManager.createTask(req.params.missionId, req.body);
      res.status(201).json({ ok: true, task });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Get single task details
  router.get("/missions/:missionId/tasks/:taskId", (req, res) => {
    const task = taskManager.getTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ ok: false, error: "Tarefa não encontrada" });
      return;
    }
    res.json({ ok: true, task });
  });

  // Update task attributes
  router.patch("/missions/:missionId/tasks/:taskId", (req, res) => {
    try {
      const task = taskManager.updateTask(req.params.taskId, req.body);
      res.json({ ok: true, task });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Transition task status (formal 6-state lifecycle)
  router.post("/missions/:missionId/tasks/:taskId/status", (req, res) => {
    try {
      const { status, reason, resultado, evidence, force } = req.body;
      if (!status) {
        res.status(400).json({ ok: false, error: "Status de destino obrigatório" });
        return;
      }
      const task = taskManager.transitionTask(req.params.taskId, status, {
        reason,
        resultado,
        evidence,
        force,
      });
      res.json({ ok: true, task });
    } catch (err: any) {
      if (
        err instanceof InvalidTaskStateTransitionError ||
        err instanceof UnmetTaskDependencyError
      ) {
        res.status(400).json({ ok: false, error: err.message, name: err.name });
        return;
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Assign task to pane / agent
  router.post("/missions/:missionId/tasks/:taskId/atribuir", (req, res) => {
    try {
      const { paneId, responsavel, papel } = req.body;
      const task = taskManager.assignTask(
        req.params.taskId,
        paneId ?? null,
        responsavel,
        papel
      );
      res.json({ ok: true, task });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Append evidence (diff, test run, log)
  router.post("/missions/:missionId/tasks/:taskId/evidencia", (req, res) => {
    try {
      const evidence = taskManager.addEvidence(req.params.taskId, req.body);
      res.status(201).json({ ok: true, evidence });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Record knowledge note
  router.post("/missions/:missionId/tasks/:taskId/conhecimento", (req, res) => {
    try {
      const { descricao, conteudo, autor } = req.body;
      if (!descricao) {
        res.status(400).json({ ok: false, error: "Descrição do conhecimento é obrigatória" });
        return;
      }
      const evidence = taskManager.recordKnowledge(
        req.params.taskId,
        descricao,
        conteudo,
        autor
      );
      res.status(201).json({ ok: true, evidence });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Delete task
  router.delete("/missions/:missionId/tasks/:taskId", (req, res) => {
    const deleted = taskManager.deleteTask(req.params.taskId);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "Tarefa não encontrada" });
      return;
    }
    res.json({ ok: true });
  });

  // List locks for mission
  router.get("/missions/:missionId/locks", (req, res) => {
    const locks = ownershipManager.listLocks(req.params.missionId);
    res.json({ ok: true, locks });
  });

  // Acquire file locks (returns 409 Conflict if blocked in isolated mode)
  router.post("/missions/:missionId/locks/acquire", (req, res) => {
    const { taskId, paneId, files, mode, owner } = req.body;
    if (!taskId || !Array.isArray(files) || !mode) {
      res.status(400).json({ ok: false, error: "taskId, files e mode são obrigatórios" });
      return;
    }

    const result = ownershipManager.acquireLock({
      missionId: req.params.missionId,
      taskId,
      paneId,
      files,
      mode,
      owner,
    });

    if (!result.ok) {
      res.status(409).json(result);
      return;
    }

    res.json(result);
  });

  // Release file locks
  router.post("/missions/:missionId/locks/release", (req, res) => {
    const { taskId, files } = req.body;
    if (!taskId) {
      res.status(400).json({ ok: false, error: "taskId é obrigatório" });
      return;
    }
    const result = ownershipManager.releaseLock(taskId, files);
    res.json({ ok: true, ...result });
  });

  return router;
}
