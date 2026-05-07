import { type PasswordHasher } from "#/application/ports/auth";

const SALT_ROUNDS = 10;

export class BcryptPasswordHasher implements PasswordHasher {
  async hash(plainPassword: string): Promise<string> {
    return Bun.password.hash(plainPassword, {
      algorithm: "bcrypt",
      cost: SALT_ROUNDS,
    });
  }
}
