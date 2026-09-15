import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { createConnectionsRouter } from "./connections-router.ts";
import { createTasksRouter } from "./tasks-router.ts";
import { createConfigRouter } from "./config-router.ts";
import { createSkillsRouter } from "./skills-router.ts";
import { createMarketplaceRouter } from "./marketplace-router.ts";
import { createMediaRouter } from "./media-router.ts";
import { createProvidersRouter } from "./providers-router.ts";
import { createProjectsRouter } from "./projects-router.ts";
import { createPanesRouter } from "./panes-router.ts";
import { createMissionsRouter } from "./missions-router.ts";
import { createVoiceRouter } from "./voice-router.ts";
import { createAccountPoolsRouter } from "./account-pools-router.ts";
import { criarFsApi } from "./fs-api.ts";

export * from "./types.ts";
export * from "./fs-api.ts";
export * from "./panes-router.ts";
export * from "./voice-router.ts";
export * from "./config-router.ts";
export * from "./skills-router.ts";
export * from "./marketplace-router.ts";
export * from "./media-router.ts";
export * from "./providers-router.ts";
export * from "./projects-router.ts";
export * from "./missions-router.ts";
export * from "./tasks-router.ts";
export * from "./connections-router.ts";
export * from "./account-pools-router.ts";

export function createApiRouter(ctx: RouterContext): Router {
  const router = Router();

  // Sub-routers
  router.use(createConnectionsRouter(ctx));
  router.use(createTasksRouter(ctx));
  router.use(createConfigRouter(ctx));
  router.use(createSkillsRouter(ctx));
  router.use(createMarketplaceRouter(ctx));
  router.use(createMediaRouter(ctx));
  router.use(createProvidersRouter(ctx));
  router.use(createProjectsRouter(ctx));
  router.use(createPanesRouter(ctx));
  router.use(createMissionsRouter(ctx));
  router.use(createAccountPoolsRouter(ctx));
  router.use(createVoiceRouter());
  router.use(criarFsApi(ctx.raizDe, ctx.ownershipManager));

  return router;
}
