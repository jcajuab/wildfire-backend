import { executeRedisCommand } from "#/infrastructure/redis/client";

interface RedisScriptingClient {
  sendCommand(
    command: readonly string[],
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

const scriptShaByName = new Map<string, string>();

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  return String(value);
};

const isNoScriptError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /NOSCRIPT/i.test(error.message);
};

const loadScript = async (
  redis: RedisScriptingClient,
  scriptName: string,
  script: string,
): Promise<string> => {
  const shaReply = await executeRedisCommand<string>(redis, [
    "SCRIPT",
    "LOAD",
    script,
  ]);
  const sha = toStringValue(shaReply);
  if (sha.length === 0) {
    throw new Error(`Failed to load Redis script: ${scriptName}`);
  }
  return sha;
};

export const evalCachedRedisScript = async (input: {
  redis: RedisScriptingClient;
  scriptName: string;
  script: string;
  keys: readonly string[];
  args: readonly string[];
}): Promise<unknown> => {
  const numKeys = String(input.keys.length);
  let sha = scriptShaByName.get(input.scriptName);

  if (!sha) {
    sha = await loadScript(input.redis, input.scriptName, input.script);
    scriptShaByName.set(input.scriptName, sha);
  }

  const evalSha = (scriptSha: string) =>
    executeRedisCommand<unknown>(input.redis, [
      "EVALSHA",
      scriptSha,
      numKeys,
      ...input.keys,
      ...input.args,
    ]);

  try {
    return await evalSha(sha);
  } catch (error) {
    if (!isNoScriptError(error)) {
      throw error;
    }

    const refreshedSha = await loadScript(
      input.redis,
      input.scriptName,
      input.script,
    );
    scriptShaByName.set(input.scriptName, refreshedSha);
    return evalSha(refreshedSha);
  }
};
