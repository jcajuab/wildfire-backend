import { describe, expect, test } from "bun:test";
import { ValidationError } from "#/application/errors/validation";
import {
  AcceptInvitationUseCase,
  CreateInvitationUseCase,
  ListInvitationsUseCase,
  ResendInvitationUseCase,
} from "#/application/use-cases/auth";

describe("Invitation use cases", () => {
  test("CreateInvitationUseCase creates invite and emits accept URL", async () => {
    const created: Array<{ email: string; invitedByUserId: string }> = [];
    const sent: Array<{ email: string; inviteUrl: string }> = [];
    const useCase = new CreateInvitationUseCase({
      userRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        findByEmail: async () => null,
        create: async ({ email, name, isActive }) => ({
          id: "user-1",
          email,
          name,
          isActive: isActive ?? true,
        }),
        update: async () => null,
        delete: async () => false,
      },
      invitationRepository: {
        create: async (input) => {
          created.push({
            email: input.email,
            invitedByUserId: input.invitedByUserId,
          });
        },
        findActiveByHashedToken: async () => null,
        findById: async () => null,
        listRecent: async () => [],
        revokeActiveByEmail: async () => {},
        markAccepted: async () => {},
        deleteExpired: async () => {},
      },
      invitationEmailSender: {
        sendInvite: async (input) => {
          sent.push({ email: input.email, inviteUrl: input.inviteUrl });
        },
      },
      inviteTokenTtlSeconds: 3600,
      inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
    });

    const result = await useCase.execute({
      email: "Invited.User@example.com",
      name: "Invited User",
      invitedByUserId: "admin-1",
    });

    expect(created).toEqual([
      { email: "invited.user@example.com", invitedByUserId: "admin-1" },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.inviteUrl).toContain(
      "http://localhost:3000/accept-invite?token=",
    );
    expect(result.id).toEqual(expect.any(String));
    expect(result.expiresAt).toEqual(expect.any(String));
  });

  test("CreateInvitationUseCase rejects when user already exists", async () => {
    const useCase = new CreateInvitationUseCase({
      userRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        findByEmail: async (email) => ({
          id: "existing-user",
          email,
          name: "Existing",
          isActive: true,
        }),
        create: async ({ email, name, isActive }) => ({
          id: "user-1",
          email,
          name,
          isActive: isActive ?? true,
        }),
        update: async () => null,
        delete: async () => false,
      },
      invitationRepository: {
        create: async () => {},
        findActiveByHashedToken: async () => null,
        findById: async () => null,
        listRecent: async () => [],
        revokeActiveByEmail: async () => {},
        markAccepted: async () => {},
        deleteExpired: async () => {},
      },
      invitationEmailSender: {
        sendInvite: async () => {},
      },
      inviteTokenTtlSeconds: 3600,
      inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
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
        create: async () => {},
        findActiveByHashedToken: async () => ({
          id: "invite-1",
          email: "invited@example.com",
          name: "Invited Name",
        }),
        findById: async () => null,
        listRecent: async () => [],
        revokeActiveByEmail: async () => {},
        markAccepted: async () => {
          events.push("accepted");
        },
        deleteExpired: async () => {},
      },
      userRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        findByEmail: async () => null,
        create: async ({ email, name, isActive }) => {
          events.push("user");
          return {
            id: "user-1",
            email,
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
      password: "new-password-123",
    });

    expect(events).toEqual(["user", "credentials", "accepted"]);
  });

  test("ListInvitationsUseCase resolves invitation statuses", async () => {
    const useCase = new ListInvitationsUseCase({
      invitationRepository: {
        create: async () => {},
        findActiveByHashedToken: async () => null,
        findById: async () => null,
        listRecent: async () => [
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
        revokeActiveByEmail: async () => {},
        markAccepted: async () => {},
        deleteExpired: async () => {},
      },
    });

    const result = await useCase.execute();
    expect(result.map((item) => item.status)).toEqual(["pending", "accepted"]);
  });

  test("ResendInvitationUseCase recreates invitation from existing invite", async () => {
    const resendUseCase = new ResendInvitationUseCase({
      invitationRepository: {
        create: async () => {},
        findActiveByHashedToken: async () => null,
        findById: async () => ({
          id: "inv-1",
          email: "invite@example.com",
          name: "Invited",
        }),
        listRecent: async () => [],
        revokeActiveByEmail: async () => {},
        markAccepted: async () => {},
        deleteExpired: async () => {},
      },
      createInvitationUseCase: new CreateInvitationUseCase({
        userRepository: {
          list: async () => [],
          findById: async () => null,
          findByIds: async () => [],
          findByEmail: async () => null,
          create: async ({ email, name, isActive }) => ({
            id: "user-1",
            email,
            name,
            isActive: isActive ?? true,
          }),
          update: async () => null,
          delete: async () => false,
        },
        invitationRepository: {
          create: async () => {},
          findActiveByHashedToken: async () => null,
          findById: async () => null,
          listRecent: async () => [],
          revokeActiveByEmail: async () => {},
          markAccepted: async () => {},
          deleteExpired: async () => {},
        },
        invitationEmailSender: {
          sendInvite: async () => {},
        },
        inviteTokenTtlSeconds: 3600,
        inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
      }),
    });

    const result = await resendUseCase.execute({
      id: "inv-1",
      invitedByUserId: "admin-1",
    });

    expect(result.id).toEqual(expect.any(String));
    expect(result.expiresAt).toEqual(expect.any(String));
    expect(result.inviteUrl).toContain("accept-invite?token=");
  });
});
