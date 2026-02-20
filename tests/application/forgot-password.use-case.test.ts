import { describe, expect, test } from "bun:test";
import {
  ForgotPasswordUseCase,
  hashToken,
} from "#/application/use-cases/auth/forgot-password.use-case";

describe("ForgotPasswordUseCase", () => {
  test("stores hashed token and sends reset URL with token query parameter", async () => {
    const stored: Array<{
      hashedToken: string;
      email: string;
      expiresAt: Date;
    }> = [];
    const sent: Array<{ email: string; resetUrl: string; expiresAt: Date }> =
      [];

    const useCase = new ForgotPasswordUseCase({
      userRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        findByEmail: async (email) => ({
          id: "user-1",
          email,
          name: "Test User",
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
      passwordResetTokenRepository: {
        store: async (input) => {
          stored.push(input);
        },
        findByHashedToken: async (_hashedToken, _now) => null,
        consumeByHashedToken: async (_hashedToken) => {},
        deleteExpired: async () => {},
      },
      passwordResetEmailSender: {
        sendResetLink: async (input) => {
          sent.push(input);
        },
      },
      resetPasswordBaseUrl: "http://localhost:3000/reset-password",
    });

    await useCase.execute({ email: "User@example.com" });

    expect(stored).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.email).toBe("User@example.com");
    expect(sent[0]?.resetUrl).toContain(
      "http://localhost:3000/reset-password?token=",
    );

    const resetUrl = sent[0]?.resetUrl;
    expect(resetUrl).toBeDefined();
    if (!resetUrl) {
      throw new Error("Expected reset URL to be present");
    }

    const resetToken = new URL(resetUrl).searchParams.get("token");
    expect(resetToken).toBeTruthy();
    expect(typeof resetToken).toBe("string");
    if (!resetToken) {
      throw new Error("Expected reset token query parameter");
    }
    expect(stored[0]?.hashedToken).toBe(hashToken(resetToken));
  });

  test("does not store token or send reset URL when user does not exist", async () => {
    const stored: Array<{
      hashedToken: string;
      email: string;
      expiresAt: Date;
    }> = [];
    const sent: Array<{ email: string; resetUrl: string; expiresAt: Date }> =
      [];

    const useCase = new ForgotPasswordUseCase({
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
      passwordResetTokenRepository: {
        store: async (input) => {
          stored.push(input);
        },
        findByHashedToken: async (_hashedToken, _now) => null,
        consumeByHashedToken: async (_hashedToken) => {},
        deleteExpired: async () => {},
      },
      passwordResetEmailSender: {
        sendResetLink: async (input) => {
          sent.push(input);
        },
      },
      resetPasswordBaseUrl: "http://localhost:3000/reset-password",
    });

    await useCase.execute({ email: "missing@example.com" });

    expect(stored).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});
