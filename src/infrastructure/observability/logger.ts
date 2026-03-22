import pino from "pino";
import { env } from "#/env";

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: {
      service: "wildfire",
    },
  },
  pino.destination({ fd: 1, sync: true }),
);
