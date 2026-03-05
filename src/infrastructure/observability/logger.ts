import pino from "pino";
import { env } from "#/env";

const transport = env.LOG_PRETTY
  ? pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
      },
    })
  : undefined;

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: {
      service: "wildfire",
    },
  },
  transport,
);
