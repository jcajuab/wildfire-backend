import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { type EncryptionService } from "#/application/ports/encryption";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

export class AIKeyEncryptionService implements EncryptionService {
  constructor(
    // Master key from environment variable - 32 bytes for AES-256
    private readonly masterKey: Buffer,
  ) {
    if (masterKey.length !== 32) {
      throw new Error("Master key must be 32 bytes for AES-256");
    }
  }

  encrypt(plaintext: string): {
    encryptedKey: string;
    iv: string;
    authTag: string;
  } {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);

    let encrypted = cipher.update(plaintext, "utf8", "base64");
    encrypted += cipher.final("base64");

    const authTag = cipher.getAuthTag();

    return {
      encryptedKey: encrypted,
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  }

  decrypt(input: {
    encryptedKey: string;
    iv: string;
    authTag: string;
  }): string {
    const iv = Buffer.from(input.iv, "base64");
    const authTag = Buffer.from(input.authTag, "base64");

    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(input.encryptedKey, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  generateKeyHint(apiKey: string): string {
    // Show last 4 chars with prefix: "...1234"
    if (apiKey.length <= 4) {
      return `...${"*".repeat(apiKey.length)}`;
    }
    return `...${apiKey.slice(-4)}`;
  }
}
