import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  buildRefreshTokenValue,
  createRefreshTokenSecret,
  hashRefreshTokenSecret,
} from "#/application/auth/refresh-token";
import {
  type AuthSessionRepository,
  type Clock,
  type TokenIssuer,
} from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";
import {
  InvalidCredentialsError,
  RefreshSessionUseCase,
} from "#/application/use-cases/auth";
import { logger } from "#/infrastructure/observability/logger";

const tokenTtlSeconds = 60 * 60;
const graceWindowSeconds = 30;
const nowSeconds = 1_700_000_000;
const sessionId = "session-1";
const userId = "user-1";
const familyId = "family-1";

interface FakeSession {
  id: string;
  userId: string;
  familyId: string;
  currentJti: string;
  previousJti: string | null;
  previousJtiExpiresAt: Date | null;
  expiresAt: Date;
}

const makeTokenIssuer = (): TokenIssuer => ({
  issueToken: async (input) =>
    `${input.subject}:${input.issuedAt}:${input.expiresAt}`,
});

const makeClock = (seconds: number): Clock => ({ nowSeconds: () => seconds });

const makeUserRepository = (): UserRepository => ({
  list: async () => [],
  findById: async (id) =>
    id === userId
      ? {
          id: userId,
          username: "tester",
          email: "tester@example.com",
          name: "Tester",
          isActive: true,
        }
      : null,
  findByIds: async () => [],
  findByUsername: async () => null,
  findByEmail: async () => null,
  create: async ({ username, email, name, isActive }) => ({
    id: userId,
    username,
    email: email ?? null,
    name,
    isActive: isActive ?? true,
  }),
  update: async (id, patch) =>
    id === userId
      ? {
          id: userId,
          username: "tester",
          email: "tester@example.com",
          name: "Tester",
          isActive: true,
          lastSeenAt: patch?.lastSeenAt ?? null,
        }
      : null,
  delete: async () => false,
});

interface FakeSessionRepo {
  repo: AuthSessionRepository;
  state: { session: FakeSession };
  calls: {
    updateCurrentJtiOptimistic: Array<{
      expectedCurrentJti: string;
      newJti: string;
    }>;
    revokeByFamilyId: number;
  };
}

const makeSessionRepository = (
  initial: FakeSession,
  options: {
    updateBehavior?: (
      state: { session: FakeSession },
      input: {
        expectedCurrentJti: string;
        newJti: string;
        previousJti: string;
        previousJtiExpiresAt: Date;
        newExpiresAt: Date;
      },
    ) => boolean;
  } = {},
): FakeSessionRepo => {
  const state = { session: initial };
  const calls = {
    updateCurrentJtiOptimistic: [] as Array<{
      expectedCurrentJti: string;
      newJti: string;
    }>,
    revokeByFamilyId: 0,
  };

  const defaultBehavior = (
    s: { session: FakeSession },
    input: {
      expectedCurrentJti: string;
      newJti: string;
      previousJti: string;
      previousJtiExpiresAt: Date;
      newExpiresAt: Date;
    },
  ) => {
    if (s.session.currentJti !== input.expectedCurrentJti) {
      return false;
    }
    s.session = {
      ...s.session,
      currentJti: input.newJti,
      previousJti: input.previousJti,
      previousJtiExpiresAt: input.previousJtiExpiresAt,
      expiresAt: input.newExpiresAt,
    };
    return true;
  };

  const repo: AuthSessionRepository = {
    create: async () => {},
    extendExpiry: async () => {},
    revokeById: async () => {},
    revokeAllForUser: async () => {},
    isActive: async () => true,
    isOwnedByUser: async () => true,
    findBySessionId: async (id) =>
      id === state.session.id ? state.session : null,
    updateCurrentJtiOptimistic: async (input) => {
      calls.updateCurrentJtiOptimistic.push({
        expectedCurrentJti: input.expectedCurrentJti,
        newJti: input.newJti,
      });
      const behavior = options.updateBehavior ?? defaultBehavior;
      return behavior(state, input);
    },
    revokeByFamilyId: async () => {
      calls.revokeByFamilyId += 1;
      return 1;
    },
  };

  return { repo, state, calls };
};

const makeUseCase = (authSessionRepository: AuthSessionRepository) =>
  new RefreshSessionUseCase({
    tokenIssuer: makeTokenIssuer(),
    userRepository: makeUserRepository(),
    clock: makeClock(nowSeconds),
    tokenTtlSeconds,
    graceWindowSeconds,
    authSessionRepository,
  });

describe("RefreshSessionUseCase grace window", () => {
  const loggerInfoSpy = mock(() => {});
  let originalLoggerInfo: typeof logger.info;

  beforeEach(() => {
    loggerInfoSpy.mockClear();
    originalLoggerInfo = logger.info;
    (logger as unknown as { info: typeof logger.info }).info =
      loggerInfoSpy as unknown as typeof logger.info;
  });

  afterEach(() => {
    (logger as unknown as { info: typeof logger.info }).info =
      originalLoggerInfo;
  });

  test("(a) fresh refresh with matching currentJti rotates and issues tokens", async () => {
    const initialSecret = createRefreshTokenSecret();
    const initialHash = hashRefreshTokenSecret(initialSecret);
    const refreshToken = buildRefreshTokenValue(sessionId, initialSecret);

    const fake = makeSessionRepository({
      id: sessionId,
      userId,
      familyId,
      currentJti: initialHash,
      previousJti: null,
      previousJtiExpiresAt: null,
      expiresAt: new Date((nowSeconds + tokenTtlSeconds) * 1000),
    });

    const useCase = makeUseCase(fake.repo);
    const result = await useCase.execute({ refreshToken });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshTokenExpiresAt).toBeDefined();
    expect(fake.calls.updateCurrentJtiOptimistic).toHaveLength(1);
    expect(fake.calls.updateCurrentJtiOptimistic[0]?.expectedCurrentJti).toBe(
      initialHash,
    );
    expect(fake.calls.revokeByFamilyId).toBe(0);
    expect(fake.state.session.previousJti).toBe(initialHash);
    expect(fake.state.session.currentJti).not.toBe(initialHash);
  });

  test("(b) second call within grace window on previousJti returns current tokens without re-rotating and logs grace_hit", async () => {
    const oldSecret = createRefreshTokenSecret();
    const oldHash = hashRefreshTokenSecret(oldSecret);
    const currentHash = hashRefreshTokenSecret(createRefreshTokenSecret());
    const refreshToken = buildRefreshTokenValue(sessionId, oldSecret);
    const graceExpiresAt = new Date((nowSeconds + graceWindowSeconds) * 1000);

    const fake = makeSessionRepository({
      id: sessionId,
      userId,
      familyId,
      currentJti: currentHash,
      previousJti: oldHash,
      previousJtiExpiresAt: graceExpiresAt,
      expiresAt: new Date((nowSeconds + tokenTtlSeconds) * 1000),
    });

    const useCase = makeUseCase(fake.repo);
    const result = await useCase.execute({ refreshToken });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeUndefined();
    expect(result.refreshTokenExpiresAt).toBeUndefined();
    expect(fake.calls.updateCurrentJtiOptimistic).toHaveLength(0);
    expect(fake.calls.revokeByFamilyId).toBe(0);
    // Session not mutated on grace hit.
    expect(fake.state.session.currentJti).toBe(currentHash);
    expect(fake.state.session.previousJti).toBe(oldHash);

    const graceLogs = loggerInfoSpy.mock.calls.filter((call) => {
      const payload = (call as unknown as Array<{ event?: string }>)[0];
      return payload?.event === "auth.refresh.grace_hit";
    });
    expect(graceLogs).toHaveLength(1);
  });

  test("(c) refresh after grace expiry revokes family and throws", async () => {
    const oldSecret = createRefreshTokenSecret();
    const oldHash = hashRefreshTokenSecret(oldSecret);
    const currentHash = hashRefreshTokenSecret(createRefreshTokenSecret());
    const refreshToken = buildRefreshTokenValue(sessionId, oldSecret);
    // Grace already expired (1s before now).
    const graceExpiresAt = new Date((nowSeconds - 1) * 1000);

    const fake = makeSessionRepository({
      id: sessionId,
      userId,
      familyId,
      currentJti: currentHash,
      previousJti: oldHash,
      previousJtiExpiresAt: graceExpiresAt,
      expiresAt: new Date((nowSeconds + tokenTtlSeconds) * 1000),
    });

    const useCase = makeUseCase(fake.repo);

    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(fake.calls.revokeByFamilyId).toBe(1);
    expect(fake.calls.updateCurrentJtiOptimistic).toHaveLength(0);
  });

  test("(d) unknown JTI revokes family and throws", async () => {
    const unknownSecret = createRefreshTokenSecret();
    const refreshToken = buildRefreshTokenValue(sessionId, unknownSecret);
    const currentHash = hashRefreshTokenSecret(createRefreshTokenSecret());

    const fake = makeSessionRepository({
      id: sessionId,
      userId,
      familyId,
      currentJti: currentHash,
      previousJti: null,
      previousJtiExpiresAt: null,
      expiresAt: new Date((nowSeconds + tokenTtlSeconds) * 1000),
    });

    const useCase = makeUseCase(fake.repo);

    await expect(useCase.execute({ refreshToken })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(fake.calls.revokeByFamilyId).toBe(1);
    expect(fake.calls.updateCurrentJtiOptimistic).toHaveLength(0);
  });

  test("(e) optimistic-conflict fallback (presented matches currentJti, concurrent update wins) returns current tokens idempotently", async () => {
    const presentedSecret = createRefreshTokenSecret();
    const presentedHash = hashRefreshTokenSecret(presentedSecret);
    const winningNewHash = hashRefreshTokenSecret(createRefreshTokenSecret());
    const refreshToken = buildRefreshTokenValue(sessionId, presentedSecret);
    const graceExpiresAt = new Date((nowSeconds + graceWindowSeconds) * 1000);

    // Simulate concurrent rotation: the session still reports currentJti == presentedHash
    // on initial findBySessionId (loser's first read), but updateCurrentJtiOptimistic
    // fails because the winner already rotated. On the refetch the loser sees the new
    // current and its own presentedHash living as previousJti within grace.
    const initial: FakeSession = {
      id: sessionId,
      userId,
      familyId,
      currentJti: presentedHash,
      previousJti: null,
      previousJtiExpiresAt: null,
      expiresAt: new Date((nowSeconds + tokenTtlSeconds) * 1000),
    };

    const state = { session: initial };
    const updateCalls: Array<{ expectedCurrentJti: string }> = [];
    let revokeCount = 0;

    const repo: AuthSessionRepository = {
      create: async () => {},
      extendExpiry: async () => {},
      revokeById: async () => {},
      revokeAllForUser: async () => {},
      isActive: async () => true,
      isOwnedByUser: async () => true,
      findBySessionId: async (id) => {
        if (id !== sessionId) return null;
        return state.session;
      },
      updateCurrentJtiOptimistic: async (input) => {
        updateCalls.push({ expectedCurrentJti: input.expectedCurrentJti });
        // On first call (loser's initial attempt), a concurrent write already rotated.
        // Mutate the state to reflect the winner's rotation and return false.
        if (updateCalls.length === 1) {
          state.session = {
            ...state.session,
            currentJti: winningNewHash,
            previousJti: presentedHash,
            previousJtiExpiresAt: graceExpiresAt,
          };
          return false;
        }
        return false;
      },
      revokeByFamilyId: async () => {
        revokeCount += 1;
        return 1;
      },
    };

    const useCase = makeUseCase(repo);
    const result = await useCase.execute({ refreshToken });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeUndefined();
    expect(result.refreshTokenExpiresAt).toBeUndefined();
    // Exactly one optimistic update attempt (the failing one); no re-rotation.
    expect(updateCalls).toHaveLength(1);
    expect(revokeCount).toBe(0);
    // Session remains at winner's rotated state.
    expect(state.session.currentJti).toBe(winningNewHash);
    expect(state.session.previousJti).toBe(presentedHash);

    const graceLogs = loggerInfoSpy.mock.calls.filter((call) => {
      const payload = (call as unknown as Array<{ event?: string }>)[0];
      return payload?.event === "auth.refresh.grace_hit";
    });
    expect(graceLogs).toHaveLength(1);
  });
});

describe("RefreshSessionUseCase skipRotation (server-side RSC refresh)", () => {
  const loggerInfoSpy = mock(() => {});
  let originalLoggerInfo: typeof logger.info;

  beforeEach(() => {
    loggerInfoSpy.mockClear();
    originalLoggerInfo = logger.info;
    (logger as unknown as { info: typeof logger.info }).info =
      loggerInfoSpy as unknown as typeof logger.info;
  });

  afterEach(() => {
    (logger as unknown as { info: typeof logger.info }).info =
      originalLoggerInfo;
  });

  test("skipRotation with currentJti issues access token and does not rotate", async () => {
    const initialSecret = createRefreshTokenSecret();
    const initialHash = hashRefreshTokenSecret(initialSecret);
    const refreshToken = buildRefreshTokenValue(sessionId, initialSecret);

    const fake = makeSessionRepository({
      id: sessionId,
      userId,
      familyId,
      currentJti: initialHash,
      previousJti: null,
      previousJtiExpiresAt: null,
      expiresAt: new Date((nowSeconds + tokenTtlSeconds) * 1000),
    });

    const useCase = makeUseCase(fake.repo);
    const result = await useCase.execute({ refreshToken, skipRotation: true });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeUndefined();
    expect(result.refreshTokenExpiresAt).toBeUndefined();
    expect(fake.calls.updateCurrentJtiOptimistic).toHaveLength(0);
    expect(fake.calls.revokeByFamilyId).toBe(0);
    expect(fake.state.session.currentJti).toBe(initialHash);
  });

  test("skipRotation with previousJti within grace issues access token without rotation", async () => {
    const oldSecret = createRefreshTokenSecret();
    const oldHash = hashRefreshTokenSecret(oldSecret);
    const currentHash = hashRefreshTokenSecret(createRefreshTokenSecret());
    const refreshToken = buildRefreshTokenValue(sessionId, oldSecret);
    const graceExpiresAt = new Date((nowSeconds + graceWindowSeconds) * 1000);

    const fake = makeSessionRepository({
      id: sessionId,
      userId,
      familyId,
      currentJti: currentHash,
      previousJti: oldHash,
      previousJtiExpiresAt: graceExpiresAt,
      expiresAt: new Date((nowSeconds + tokenTtlSeconds) * 1000),
    });

    const useCase = makeUseCase(fake.repo);
    const result = await useCase.execute({ refreshToken, skipRotation: true });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeUndefined();
    expect(fake.calls.updateCurrentJtiOptimistic).toHaveLength(0);
    expect(fake.calls.revokeByFamilyId).toBe(0);

    const graceLogs = loggerInfoSpy.mock.calls.filter((call) => {
      const payload = (call as unknown as Array<{ event?: string }>)[0];
      return payload?.event === "auth.refresh.grace_hit";
    });
    expect(graceLogs).toHaveLength(1);
  });

  test("skipRotation with expired previousJti throws without revoking family", async () => {
    const oldSecret = createRefreshTokenSecret();
    const oldHash = hashRefreshTokenSecret(oldSecret);
    const currentHash = hashRefreshTokenSecret(createRefreshTokenSecret());
    const refreshToken = buildRefreshTokenValue(sessionId, oldSecret);
    const graceExpiresAt = new Date((nowSeconds - 1) * 1000);

    const fake = makeSessionRepository({
      id: sessionId,
      userId,
      familyId,
      currentJti: currentHash,
      previousJti: oldHash,
      previousJtiExpiresAt: graceExpiresAt,
      expiresAt: new Date((nowSeconds + tokenTtlSeconds) * 1000),
    });

    const useCase = makeUseCase(fake.repo);

    await expect(
      useCase.execute({ refreshToken, skipRotation: true }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(fake.calls.revokeByFamilyId).toBe(0);
    expect(fake.calls.updateCurrentJtiOptimistic).toHaveLength(0);
  });

  test("skipRotation with unknown JTI throws without revoking family", async () => {
    const unknownSecret = createRefreshTokenSecret();
    const refreshToken = buildRefreshTokenValue(sessionId, unknownSecret);
    const currentHash = hashRefreshTokenSecret(createRefreshTokenSecret());

    const fake = makeSessionRepository({
      id: sessionId,
      userId,
      familyId,
      currentJti: currentHash,
      previousJti: null,
      previousJtiExpiresAt: null,
      expiresAt: new Date((nowSeconds + tokenTtlSeconds) * 1000),
    });

    const useCase = makeUseCase(fake.repo);

    await expect(
      useCase.execute({ refreshToken, skipRotation: true }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(fake.calls.revokeByFamilyId).toBe(0);
    expect(fake.calls.updateCurrentJtiOptimistic).toHaveLength(0);
  });
});
