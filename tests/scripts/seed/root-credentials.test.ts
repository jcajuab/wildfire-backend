import { afterEach, describe, expect, test } from "bun:test";
import { resolveRootCredentials } from "../../../scripts/seed/root-credentials";

const originalRootUser = process.env.ROOT_USER;
const originalRootPassword = process.env.ROOT_PASSWORD;

afterEach(() => {
  if (originalRootUser === undefined) {
    delete process.env.ROOT_USER;
  } else {
    process.env.ROOT_USER = originalRootUser;
  }

  if (originalRootPassword === undefined) {
    delete process.env.ROOT_PASSWORD;
  } else {
    process.env.ROOT_PASSWORD = originalRootPassword;
  }
});

describe("resolveRootCredentials", () => {
  test("prefers CLI values over env", () => {
    process.env.ROOT_USER = "from-env@example.com";
    process.env.ROOT_PASSWORD = "from-env-password";

    const result = resolveRootCredentials({
      rootUser: "from-flag@example.com",
      rootPassword: "from-flag-password",
    });

    expect(result.user).toBe("from-flag@example.com");
    expect(result.password).toBe("from-flag-password");
  });

  test("falls back to env values", () => {
    process.env.ROOT_USER = "from-env@example.com";
    process.env.ROOT_PASSWORD = "from-env-password";

    const result = resolveRootCredentials({});

    expect(result.user).toBe("from-env@example.com");
    expect(result.password).toBe("from-env-password");
  });

  test("defaults to alice@example.com when root user is not set", () => {
    delete process.env.ROOT_USER;
    process.env.ROOT_PASSWORD = "password";

    const result = resolveRootCredentials({});

    expect(result.user).toBe("alice@example.com");
    expect(result.password).toBe("password");
  });

  test("requires a root password", () => {
    process.env.ROOT_USER = "from-env@example.com";
    delete process.env.ROOT_PASSWORD;

    expect(() => resolveRootCredentials({})).toThrow("Missing root password");
  });
});
