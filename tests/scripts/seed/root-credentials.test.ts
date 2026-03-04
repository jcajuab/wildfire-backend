import { afterEach, describe, expect, test } from "bun:test";
import { resolveRootCredentials } from "../../../scripts/seed/root-credentials";

const originalRootUsername = process.env.ROOT_USERNAME;
const originalRootEmail = process.env.ROOT_EMAIL;
const originalRootPassword = process.env.ROOT_PASSWORD;

afterEach(() => {
  if (originalRootUsername === undefined) {
    delete process.env.ROOT_USERNAME;
  } else {
    process.env.ROOT_USERNAME = originalRootUsername;
  }

  if (originalRootEmail === undefined) {
    delete process.env.ROOT_EMAIL;
  } else {
    process.env.ROOT_EMAIL = originalRootEmail;
  }

  if (originalRootPassword === undefined) {
    delete process.env.ROOT_PASSWORD;
  } else {
    process.env.ROOT_PASSWORD = originalRootPassword;
  }
});

describe("resolveRootCredentials", () => {
  test("prefers CLI values over env", () => {
    process.env.ROOT_USERNAME = "from-env";
    process.env.ROOT_EMAIL = "from-env@example.com";
    process.env.ROOT_PASSWORD = "from-env-password";

    const result = resolveRootCredentials({
      rootUsername: "from-flag",
      rootEmail: "from-flag@example.com",
      rootPassword: "from-flag-password",
    });

    expect(result.username).toBe("from-flag");
    expect(result.email).toBe("from-flag@example.com");
    expect(result.password).toBe("from-flag-password");
  });

  test("falls back to env values", () => {
    process.env.ROOT_USERNAME = "from-env";
    process.env.ROOT_EMAIL = "from-env@example.com";
    process.env.ROOT_PASSWORD = "from-env-password";

    const result = resolveRootCredentials({});

    expect(result.username).toBe("from-env");
    expect(result.email).toBe("from-env@example.com");
    expect(result.password).toBe("from-env-password");
  });

  test("defaults to alice when root username is not set", () => {
    delete process.env.ROOT_USERNAME;
    delete process.env.ROOT_EMAIL;
    process.env.ROOT_PASSWORD = "password";

    const result = resolveRootCredentials({});

    expect(result.username).toBe("alice");
    expect(result.email).toBeNull();
    expect(result.password).toBe("password");
  });

  test("requires a root password", () => {
    process.env.ROOT_USERNAME = "from-env";
    delete process.env.ROOT_PASSWORD;

    expect(() => resolveRootCredentials({})).toThrow("Missing root password");
  });
});
