import { describe, expect, test } from "bun:test";
import { createHttpContainer } from "#/interfaces/http/container";

describe("createHttpContainer", () => {
  test("builds shared adapters and repositories", () => {
    const container = createHttpContainer({
      jwtSecret: "test-secret",
      jwtIssuer: "wildfire",
      htshadowPath: "/tmp/htshadow",
      minio: {
        endpoint: "localhost",
        port: 9000,
        useSsl: false,
        bucket: "content",
        region: "us-east-1",
        rootUser: "minioadmin",
        rootPassword: "minioadmin",
        requestTimeoutMs: 15000,
      },
    });

    expect(container.repositories.userRepository).toBeDefined();
    expect(container.repositories.authorizationRepository).toBeDefined();
    expect(container.repositories.authSessionRepository).toBeDefined();
    expect(container.repositories.auditEventRepository).toBeDefined();
    expect(container.repositories.contentRepository).toBeDefined();
    expect(container.repositories.invitationRepository).toBeDefined();
    expect(container.repositories.roleDeletionRequestRepository).toBeDefined();
    expect(container.repositories.systemSettingRepository).toBeDefined();
    expect(container.auth.credentialsRepository).toBeDefined();
    expect(container.auth.passwordVerifier).toBeDefined();
    expect(container.auth.passwordHasher).toBeDefined();
    expect(container.auth.tokenIssuer).toBeDefined();
    expect(container.auth.clock).toBeDefined();
    expect(container.auth.invitationEmailSender).toBeDefined();
    expect(container.storage.contentStorage).toBeDefined();
    expect(container.storage.minioEndpoint).toBe("http://localhost:9000");
  });

  test("builds https endpoint when SSL is enabled", () => {
    const container = createHttpContainer({
      jwtSecret: "test-secret",
      htshadowPath: "/tmp/htshadow",
      minio: {
        endpoint: "storage.example.local",
        port: 9443,
        useSsl: true,
        bucket: "content",
        region: "us-east-1",
        rootUser: "minioadmin",
        rootPassword: "minioadmin",
        requestTimeoutMs: 15000,
      },
    });

    expect(container.storage.minioEndpoint).toBe(
      "https://storage.example.local:9443",
    );
  });
});
