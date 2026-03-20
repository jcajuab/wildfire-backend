export interface EncryptionService {
  encrypt(plaintext: string): {
    encryptedKey: string;
    iv: string;
    authTag: string;
  };
  decrypt(input: { encryptedKey: string; iv: string; authTag: string }): string;
  generateKeyHint(key: string): string;
}
