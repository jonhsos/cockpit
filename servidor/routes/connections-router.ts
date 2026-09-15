import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { createConnectionRoutes } from "../connections/index.ts";

export function createConnectionsRouter(ctx: RouterContext): Router {
  return createConnectionRoutes(ctx.bridge);
}
