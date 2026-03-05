type IntegrationMySqlEnv = Readonly<{
  MYSQL_HOST: string;
  MYSQL_PORT: string;
  MYSQL_DATABASE: string;
  MYSQL_USER: string;
  MYSQL_PASSWORD: string;
}>;

type IntegrationMinioConfig = Readonly<{
  endpointUrl: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}>;

const normalizeString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : undefined;
};

const parseBooleanEnv = (
  value: string | undefined,
  key: string,
  defaultValue: boolean,
): boolean => {
  const normalized = normalizeString(value);

  if (normalized === undefined) {
    return defaultValue;
  }

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new Error(
    `Invalid boolean value for ${key}: ${value}. Expected "true" or "false".`,
  );
};

const parsePort = (
  value: string | undefined,
  key: string,
  defaultValue: string,
): string => {
  const normalized = normalizeString(value);

  if (normalized === undefined) {
    return defaultValue;
  }

  const maybeNumber = Number(normalized);
  if (
    !Number.isInteger(maybeNumber) ||
    maybeNumber <= 0 ||
    maybeNumber > 65535
  ) {
    throw new Error(
      `Invalid value for ${key}: ${value}. Expected a TCP port number between 1 and 65535.`,
    );
  }

  return String(maybeNumber);
};

const parseRequiredEnv = (
  value: string | undefined,
  _key: string,
  fallback: string,
): string => {
  const normalized = normalizeString(value);
  if (normalized === undefined) {
    return fallback;
  }
  return normalized;
};

const hasMinioIntegrationCredentials = () =>
  Boolean(
    normalizeString(process.env.MINIO_ENDPOINT) &&
      normalizeString(process.env.MINIO_BUCKET) &&
      normalizeString(process.env.MINIO_ROOT_USER) &&
      normalizeString(process.env.MINIO_ROOT_PASSWORD),
  );

export const isRunIntegrationEnabled = (): boolean => {
  return parseBooleanEnv(process.env.RUN_INTEGRATION, "RUN_INTEGRATION", false);
};

export const getIntegrationMySqlEnv = (): IntegrationMySqlEnv => {
  return {
    MYSQL_HOST: parseRequiredEnv(
      process.env.MYSQL_HOST,
      "MYSQL_HOST",
      "127.0.0.1",
    ),
    MYSQL_PORT: parsePort(process.env.MYSQL_PORT, "MYSQL_PORT", "3306"),
    MYSQL_DATABASE: parseRequiredEnv(
      process.env.MYSQL_DATABASE,
      "MYSQL_DATABASE",
      "wildfire_test",
    ),
    MYSQL_USER: parseRequiredEnv(
      process.env.MYSQL_USER,
      "MYSQL_USER",
      "wildfire",
    ),
    MYSQL_PASSWORD: parseRequiredEnv(
      process.env.MYSQL_PASSWORD,
      "MYSQL_PASSWORD",
      "wildfire",
    ),
  };
};

export const getIntegrationMinioConfig = (
  bucket: string,
): IntegrationMinioConfig => {
  if (!hasMinioIntegrationCredentials()) {
    throw new Error(
      "RUN_INTEGRATION=true requires MINIO_ENDPOINT, MINIO_BUCKET, MINIO_ROOT_USER, and MINIO_ROOT_PASSWORD",
    );
  }

  const endpoint = parseRequiredEnv(
    process.env.MINIO_ENDPOINT,
    "MINIO_ENDPOINT",
    "localhost",
  );
  const port = parsePort(process.env.MINIO_PORT, "MINIO_PORT", "9000");
  const useSsl = parseBooleanEnv(
    process.env.MINIO_USE_SSL,
    "MINIO_USE_SSL",
    false,
  );
  const region = parseRequiredEnv(
    process.env.MINIO_REGION,
    "MINIO_REGION",
    "us-east-1",
  );
  const accessKeyId = parseRequiredEnv(
    process.env.MINIO_ROOT_USER,
    "MINIO_ROOT_USER",
    "minioadmin",
  );
  const secretAccessKey = parseRequiredEnv(
    process.env.MINIO_ROOT_PASSWORD,
    "MINIO_ROOT_PASSWORD",
    "minioadmin",
  );

  return {
    endpointUrl: `${useSsl ? "https" : "http"}://${endpoint}:${port}`,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
};
