export interface SeedRootCredentials {
  user: string;
  password: string;
}

export const resolveRootCredentials = (input: {
  rootUser?: string;
  rootPassword?: string;
}): SeedRootCredentials => {
  const user = (input.rootUser ?? process.env.ROOT_USER)?.trim();
  const password = input.rootPassword ?? process.env.ROOT_PASSWORD;

  if (!user) {
    throw new Error("Missing root user. Set ROOT_USER or pass --root-user.");
  }
  if (!user.includes("@")) {
    throw new Error(`Invalid root user email: ${user}`);
  }
  if (!password || password.trim().length === 0) {
    throw new Error(
      "Missing root password. Set ROOT_PASSWORD or pass --root-password.",
    );
  }

  return { user, password: password.trim() };
};
