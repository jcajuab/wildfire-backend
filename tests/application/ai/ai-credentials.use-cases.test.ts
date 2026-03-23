import { describe, expect, test } from "bun:test";
import { NotFoundError } from "#/application/errors/not-found";
import { ValidationError } from "#/application/errors/validation";
import {
  type AICredential,
  type AICredentialsRepository,
} from "#/application/ports/ai";
import { type AuditLogger } from "#/application/ports/audit";
import { type EncryptionService } from "#/application/ports/encryption";
import {
  DeleteAICredentialUseCase,
  ListAICredentialsUseCase,
  StoreAICredentialUseCase,
} from "#/application/use-cases/ai/ai-credentials.use-cases";

const noopLogger: AuditLogger = { log: () => {} };

const makeEncryption = (): EncryptionService => ({
  encrypt: (plaintext) => ({
    encryptedKey: `enc:${plaintext}`,
    iv: "test-iv",
    authTag: "test-tag",
  }),
  decrypt: ({ encryptedKey }) => encryptedKey.replace("enc:", ""),
  generateKeyHint: (key) => `...${key.slice(-4)}`,
});

const makeCredentialsRepo = (): AICredentialsRepository & {
  _store: Map<
    string,
    AICredential & { encryptedKey: string; iv: string; authTag: string }
  >;
} => {
  const store = new Map<
    string,
    AICredential & { encryptedKey: string; iv: string; authTag: string }
  >();

  return {
    _store: store,
    create: async (input) => {
      const key = `${input.userId}:${input.provider}`;
      const record = {
        id: `cred-${store.size + 1}`,
        userId: input.userId,
        provider: input.provider as AICredential["provider"],
        keyHint: input.keyHint,
        encryptedKey: input.encryptedKey,
        iv: input.iv,
        authTag: input.authTag,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      store.set(key, record);
      return record;
    },
    findByUserAndProvider: async (userId, provider) => {
      const record = store.get(`${userId}:${provider}`);
      if (!record) return null;
      return {
        encryptedKey: record.encryptedKey,
        iv: record.iv,
        authTag: record.authTag,
      };
    },
    listForUser: async (userId) =>
      [...store.values()].filter((r) => r.userId === userId),
    delete: async (userId, provider) => {
      const key = `${userId}:${provider}`;
      if (!store.has(key)) return false;
      store.delete(key);
      return true;
    },
  };
};

describe("StoreAICredentialUseCase", () => {
  test("encrypts and stores a valid API key", async () => {
    const repo = makeCredentialsRepo();
    const useCase = new StoreAICredentialUseCase({
      credentialsRepository: repo,
      encryptionService: makeEncryption(),
      auditLogger: noopLogger,
    });

    const result = await useCase.execute({
      userId: "user-1",
      provider: "openai",
      apiKey: "sk-test1234",
    });

    expect(result.userId).toBe("user-1");
    expect(result.provider).toBe("openai");
    expect(result.keyHint).toBe("...1234");
    // Encrypted key stored, not raw key
    const stored = repo._store.get("user-1:openai");
    expect(stored?.encryptedKey).toBe("enc:sk-test1234");
  });

  test("throws ValidationError for empty API key", async () => {
    const useCase = new StoreAICredentialUseCase({
      credentialsRepository: makeCredentialsRepo(),
      encryptionService: makeEncryption(),
      auditLogger: noopLogger,
    });

    await expect(
      useCase.execute({ userId: "user-1", provider: "openai", apiKey: "" }),
    ).rejects.toThrow(ValidationError);
  });

  test("throws ValidationError for whitespace-only API key", async () => {
    const useCase = new StoreAICredentialUseCase({
      credentialsRepository: makeCredentialsRepo(),
      encryptionService: makeEncryption(),
      auditLogger: noopLogger,
    });

    await expect(
      useCase.execute({ userId: "user-1", provider: "openai", apiKey: "   " }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("ListAICredentialsUseCase", () => {
  test("returns empty list when no credentials stored", async () => {
    const useCase = new ListAICredentialsUseCase({
      credentialsRepository: makeCredentialsRepo(),
    });

    const result = await useCase.execute("user-1");
    expect(result).toEqual([]);
  });

  test("returns only credentials for the given user", async () => {
    const repo = makeCredentialsRepo();
    const storeUseCase = new StoreAICredentialUseCase({
      credentialsRepository: repo,
      encryptionService: makeEncryption(),
      auditLogger: noopLogger,
    });
    await storeUseCase.execute({
      userId: "user-1",
      provider: "openai",
      apiKey: "sk-a",
    });
    await storeUseCase.execute({
      userId: "user-1",
      provider: "anthropic",
      apiKey: "sk-b",
    });
    await storeUseCase.execute({
      userId: "user-2",
      provider: "openai",
      apiKey: "sk-c",
    });

    const listUseCase = new ListAICredentialsUseCase({
      credentialsRepository: repo,
    });
    const result = await listUseCase.execute("user-1");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.provider).sort()).toEqual([
      "anthropic",
      "openai",
    ]);
  });
});

describe("DeleteAICredentialUseCase", () => {
  test("deletes an existing credential", async () => {
    const repo = makeCredentialsRepo();
    const storeUseCase = new StoreAICredentialUseCase({
      credentialsRepository: repo,
      encryptionService: makeEncryption(),
      auditLogger: noopLogger,
    });
    await storeUseCase.execute({
      userId: "user-1",
      provider: "openai",
      apiKey: "sk-test",
    });

    const deleteUseCase = new DeleteAICredentialUseCase({
      credentialsRepository: repo,
      auditLogger: noopLogger,
    });
    await expect(
      deleteUseCase.execute({ userId: "user-1", provider: "openai" }),
    ).resolves.toBeUndefined();

    expect(repo._store.has("user-1:openai")).toBe(false);
  });

  test("throws NotFoundError when credential does not exist", async () => {
    const deleteUseCase = new DeleteAICredentialUseCase({
      credentialsRepository: makeCredentialsRepo(),
      auditLogger: noopLogger,
    });

    await expect(
      deleteUseCase.execute({ userId: "user-1", provider: "openai" }),
    ).rejects.toThrow(NotFoundError);
  });

  test("does not affect other users credentials", async () => {
    const repo = makeCredentialsRepo();
    const storeUseCase = new StoreAICredentialUseCase({
      credentialsRepository: repo,
      encryptionService: makeEncryption(),
      auditLogger: noopLogger,
    });
    await storeUseCase.execute({
      userId: "user-1",
      provider: "openai",
      apiKey: "sk-1",
    });
    await storeUseCase.execute({
      userId: "user-2",
      provider: "openai",
      apiKey: "sk-2",
    });

    const deleteUseCase = new DeleteAICredentialUseCase({
      credentialsRepository: repo,
      auditLogger: noopLogger,
    });
    await deleteUseCase.execute({ userId: "user-1", provider: "openai" });

    expect(repo._store.has("user-1:openai")).toBe(false);
    expect(repo._store.has("user-2:openai")).toBe(true);
  });
});
