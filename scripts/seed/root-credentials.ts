const DEFAULT_ROOT_USERNAME = "alice";

export interface SeedRootCredentials {
  username: string;
  email: string | null;
  password: string;
}

export const resolveRootCredentials = (input: {
  rootUsername?: string;
  rootEmail?: string;
  rootPassword?: string;
}): SeedRootCredentials => {
  const username = (
    input.rootUsername ??
    process.env.ROOT_USERNAME ??
    DEFAULT_ROOT_USERNAME
  ).trim();
  const emailRaw = (input.rootEmail ?? process.env.ROOT_EMAIL ?? "").trim();
  const password = input.rootPassword ?? process.env.ROOT_PASSWORD;

  if (!username) {
    throw new Error(
      "Missing root username. Set ROOT_USERNAME or pass --root-username.",
    );
  }
  if (emailRaw.length > 0 && !emailRaw.includes("@")) {
    throw new Error(`Invalid root email: ${emailRaw}`);
  }
  if (!password || password.trim().length === 0) {
    throw new Error(
      "Missing root password. Set ROOT_PASSWORD or pass --root-password.",
    );
  }

  return {
    username: username.toLowerCase(),
    email: emailRaw.length > 0 ? emailRaw.toLowerCase() : null,
    password: password.trim(),
  };
};
