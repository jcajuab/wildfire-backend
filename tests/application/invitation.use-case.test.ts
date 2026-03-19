import { describe, expect, test } from "bun:test";
import { ValidationError } from "#/application/errors/validation";
import {
  AcceptInvitationUseCase,
  CreateInvitationUseCase,
  ListInvitationsUseCase,
  ResendInvitationUseCase,
} from "#/application/use-cases/auth";
import { type AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";

const mockEncryptionService = {
  encrypt: () => ({
    encryptedKey: "encrypted-key",
    iv: "mock-iv",
    authTag: "mock-auth-tag",
  }),
  decrypt: () => "decrypted-token",
  generateKeyHint: (key: string) => `...${key.slice(-4)}`,
} as unknown as AIKeyEncryptionService;

const noopInvitationRepository = {
  create: async () => {},
  findActiveByHashedToken: async () => null,
  findById: async () => null,
  findEncryptedTokenById: async () => null,
  countAll: async () => 0,
  listPage: async () => [],
  revokeActiveByEmail: async () => {},
  markAccepted: async () => {},
  deleteExpired: async () => {},
};

describe("Invitation use cases", () => {
  test("CreateInvitationUseCase creates invite and returns id/expiresAt", async () => {
    const created: Array<{ email: string; invitedByUserId: string }> = [];
    const useCase = new CreateInvitationUseCase({
      userRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        findByUsername: async () => null,
        findByEmail: async () => null,
        create: async ({ username, email, name, isActive }) => ({
          id: "user-1",
          username,
          email: email ?? null,
          name,
          isActive: isActive ?? true,
        }),
        update: async () => null,
        delete: async () => false,
      },
      invitationRepository: {
        ...noopInvitationRepository,
        create: async (input) => {
          created.push({
            email: input.email,
            invitedByUserId: input.invitedByUserId,
          });
        },
      },
      inviteTokenTtlSeconds: 3600,
      inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
      encryptionService: mockEncryptionService,
    });

    const result = await useCase.execute({
      email: "Invited.User@example.com",
      name: "Invited User",
      invitedByUserId: "admin-1",
    });

    expect(created).toEqual([
      { email: "invited.user@example.com", invitedByUserId: "admin-1" },
    ]);
    expect(result.id).toEqual(expect.any(String));
    expect(result.expiresAt).toEqual(expect.any(String));
  });

  test("CreateInvitationUseCase rejects when user already exists", async () => {
    const useCase = new CreateInvitationUseCase({
      userRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        findByUsername: async () => null,
        findByEmail: async (email) => ({
          id: "existing-user",
          username: "existing",
          email,
          name: "Existing",
          isActive: true,
        }),
        create: async ({ username, email, name, isActive }) => ({
          id: "user-1",
          username,
          email: email ?? null,
          name,
          isActive: isActive ?? true,
        }),
        update: async () => null,
        delete: async () => false,
      },
      invitationRepository: noopInvitationRepository,
      inviteTokenTtlSeconds: 3600,
      inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
      encryptionService: mockEncryptionService,
    });

    await expect(
      useCase.execute({
        email: "existing@example.com",
        invitedByUserId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("AcceptInvitationUseCase creates user, credentials, and marks invite accepted", async () => {
    const events: string[] = [];
    const useCase = new AcceptInvitationUseCase({
      invitationRepository: {
        ...noopInvitationRepository,
        findActiveByHashedToken: async () => ({
          id: "invite-1",
          email: "invited@example.com",
          name: "Invited Name",
        }),
        markAccepted: async () => {
          events.push("accepted");
        },
      },
      userRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        findByUsername: async () => null,
        findByEmail: async () => null,
        create: async ({ username, email, name, isActive }) => {
          events.push("user");
          return {
            id: "user-1",
            username,
            email: email ?? null,
            name,
            isActive: isActive ?? true,
          };
        },
        update: async () => null,
        delete: async () => false,
      },
      passwordHasher: {
        hash: async () => "hashed-password",
      },
      credentialsRepository: {
        findPasswordHash: async () => null,
        updatePasswordHash: async () => {},
        createPasswordHash: async () => {
          events.push("credentials");
        },
      },
    });

    await useCase.execute({
      token: "invite-token",
      username: "brandnew",
      password: "new-password-123",
    });

    expect(events).toEqual(["user", "credentials", "accepted"]);
  });

  test("ListInvitationsUseCase resolves invitation statuses", async () => {
    const useCase = new ListInvitationsUseCase({
      invitationRepository: {
        ...noopInvitationRepository,
        countAll: async () => 2,
        listPage: async () => [
          {
            id: "inv-1",
            email: "pending@example.com",
            name: null,
            expiresAt: new Date(Date.now() + 60_000),
            acceptedAt: null,
            revokedAt: null,
            createdAt: new Date(),
          },
          {
            id: "inv-2",
            email: "accepted@example.com",
            name: null,
            expiresAt: new Date(Date.now() + 60_000),
            acceptedAt: new Date(),
            revokedAt: null,
            createdAt: new Date(),
          },
        ],
      },
    });

    const result = await useCase.execute();
    expect(result.items.map((item) => item.status)).toEqual([
      "pending",
      "accepted",
    ]);
  });

  test("ResendInvitationUseCase recreates invitation from existing invite", async () => {
    const resendUseCase = new ResendInvitationUseCase({
      invitationRepository: {
        ...noopInvitationRepository,
        findById: async () => ({
          id: "inv-1",
          email: "invite@example.com",
          name: "Invited",
        }),
      },
      createInvitationUseCase: new CreateInvitationUseCase({
        userRepository: {
          list: async () => [],
          findById: async () => null,
          findByIds: async () => [],
          findByUsername: async () => null,
          findByEmail: async () => null,
          create: async ({ username, email, name, isActive }) => ({
            id: "user-1",
            username,
            email: email ?? null,
            name,
            isActive: isActive ?? true,
          }),
          update: async () => null,
          delete: async () => false,
        },
        invitationRepository: noopInvitationRepository,
        inviteTokenTtlSeconds: 3600,
        inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
        encryptionService: mockEncryptionService,
      }),
    });

    const result = await resendUseCase.execute({
      id: "inv-1",
      invitedByUserId: "admin-1",
    });

    expect(result.id).toEqual(expect.any(String));
    expect(result.expiresAt).toEqual(expect.any(String));
  });
});
