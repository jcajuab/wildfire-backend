import { Hono } from "hono";
import { registerDisplayRuntimeAuthRoutes } from "./auth.route";
import { type DisplayRuntimeRouterModule, type DisplayVars } from "./deps";
import { registerDisplayRuntimeHeartbeatRoutes } from "./heartbeat.route";
import { registerDisplayRuntimeManifestRoutes } from "./manifest.route";
import { registerDisplayRuntimeSnapshotRoutes } from "./snapshot.route";
import { registerDisplayRuntimeStreamRoutes } from "./stream.route";

export const createDisplayRouter = ({
  deps,
  useCases,
}: DisplayRuntimeRouterModule) => {
  const router = new Hono<{ Variables: DisplayVars }>();

  registerDisplayRuntimeAuthRoutes({ router, deps, useCases });
  registerDisplayRuntimeManifestRoutes({ router, useCases });
  registerDisplayRuntimeStreamRoutes({ router, deps, useCases });
  registerDisplayRuntimeSnapshotRoutes({ router, useCases });
  registerDisplayRuntimeHeartbeatRoutes({ router, useCases });

  return router;
};

export type {
  DisplayRuntimeRouterDeps,
  DisplayRuntimeRouterModule,
} from "./deps";
