import { DEMO_DEFAULT_USER_PASSWORD } from "./constants";

const normalizeString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : undefined;
};

export const getSeedScriptEnv = () => {
  const demoUserPassword = normalizeString(process.env.DEMO_USER_PASSWORD);

  return {
    demoUserPassword: demoUserPassword ?? DEMO_DEFAULT_USER_PASSWORD,
  };
};
