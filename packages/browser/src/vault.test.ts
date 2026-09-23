import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateVaultKey } from "./vault.js";

describe("generateVaultKey", () => {
  it("produces a 64-character hex string (32 bytes)", () => {
    const key = generateVaultKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is different on every call", () => {
    expect(generateVaultKey()).not.toBe(generateVaultKey());
  });
});

describe("encryptSecret / decryptSecret — round trip", () => {
  it("round-trips plaintext through a random key", () => {
    const key = generateVaultKey();
    const plaintext = "correct horse battery staple";
    const ciphertext = encryptSecret(plaintext, key);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptSecret(ciphertext, key)).toBe(plaintext);
  });

  it("round-trips unicode and empty-ish secrets", () => {
    const key = generateVaultKey();
    for (const plaintext of ["", "🔐 sécret pässwörd", "a".repeat(5000)]) {
      const ciphertext = encryptSecret(plaintext, key);
      expect(decryptSecret(ciphertext, key)).toBe(plaintext);
    }
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const key = generateVaultKey();
    const a = encryptSecret("same secret", key);
    const b = encryptSecret("same secret", key);
    expect(a).not.toBe(b);
  });

  it("never leaks plaintext into the ciphertext envelope format", () => {
    const key = generateVaultKey();
    const ciphertext = encryptSecret("hunter2", key);
    const [ivHex, authTagHex, cipherHex] = ciphertext.split(":");
    expect(ivHex).toMatch(/^[0-9a-f]{24}$/); // 12 bytes
    expect(authTagHex).toMatch(/^[0-9a-f]{32}$/); // 16 bytes
    expect(cipherHex).toMatch(/^[0-9a-f]+$/);
  });
});

describe("decryptSecret — tamper detection (GCM auth tag)", () => {
  it("throws when the ciphertext bytes are altered", () => {
    const key = generateVaultKey();
    const ciphertext = encryptSecret("do not tamper with me", key);
    const [iv, authTag, cipherHex] = ciphertext.split(":");
    // Flip the last hex nibble of the ciphertext.
    const tamperedHex = cipherHex!.slice(0, -1) + (cipherHex!.at(-1) === "0" ? "1" : "0");
    const tampered = `${iv}:${authTag}:${tamperedHex}`;
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("throws when the auth tag is altered", () => {
    const key = generateVaultKey();
    const ciphertext = encryptSecret("do not tamper with me", key);
    const [iv, authTag, cipherHex] = ciphertext.split(":");
    const tamperedTag = authTag!.slice(0, -1) + (authTag!.at(-1) === "0" ? "1" : "0");
    const tampered = `${iv}:${tamperedTag}:${cipherHex}`;
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("throws when decrypted with the wrong key", () => {
    const key = generateVaultKey();
    const wrongKey = generateVaultKey();
    const ciphertext = encryptSecret("do not tamper with me", key);
    expect(() => decryptSecret(ciphertext, wrongKey)).toThrow();
  });

  it("throws on a malformed payload", () => {
    const key = generateVaultKey();
    expect(() => decryptSecret("not-a-valid-payload", key)).toThrow();
  });

  it("throws when CAI_VAULT_KEY is not set and no key is passed", () => {
    const original = process.env.CAI_VAULT_KEY;
    delete process.env.CAI_VAULT_KEY;
    try {
      expect(() => encryptSecret("x")).toThrow();
    } finally {
      if (original !== undefined) process.env.CAI_VAULT_KEY = original;
    }
  });
});
