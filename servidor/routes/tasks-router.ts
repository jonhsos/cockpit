import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { criarTaskRoutes } from "../tasks/index.ts";

export function createTasksRouter(ctx: RouterContext): Router {
  return criarTaskRoutes(ctx.taskManager, ctx.ownershipManager);
}
