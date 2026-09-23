/**
 * Encrypted portal credential vault (Technical Build Spec §16 Security):
 * "Encrypt sensitive credentials/tokens" and "No credential exposure to
 * model prompts unless strictly necessary". Plaintext secrets never touch
 * the database, logs, or a model prompt — only the AES-256-GCM ciphertext
 * is persisted, in `portal_credentials.secret_ciphertext`.
 *
 * Key management: a single 32-byte (256-bit) key, hex-encoded, from the
 * `CAI_VAULT_KEY` env var. `generateVaultKey()` mints one for local/dev use
 * (`.env`) — production key material belongs in a secrets manager, not in
 * source control.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@cai/db";
import { portalCredentials } from "@cai/db";
import { recordAudit } from "@cai/core";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // recommended nonce size for GCM

/** Generates a fresh 32-byte key, hex-encoded — suitable for `CAI_VAULT_KEY`. */
export function generateVaultKey(): string {
  return randomBytes(KEY_BYTES).toString("hex");
}

function loadKey(explicitKeyHex?: string): Buffer {
  const keyHex = explicitKeyHex ?? process.env.CAI_VAULT_KEY;
  if (!keyHex) {
    throw new Error(
      "CAI_VAULT_KEY is not set. Generate one with generateVaultKey() and store it as an env var / secret.",
    );
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(`CAI_VAULT_KEY must decode to ${KEY_BYTES} bytes (a 64-character hex string).`);
  }
  return key;
}

/**
 * Encrypts `plaintext` with AES-256-GCM. Output format is
 * `<iv-hex>:<authTag-hex>:<ciphertext-hex>` — self-contained, safe to store
 * as a single text column.
 */
export function encryptSecret(plaintext: string, keyHex?: string): string {
  const key = loadKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts a value produced by `encryptSecret`. Throws if the ciphertext,
 * IV, or auth tag were tampered with (GCM authentication failure) — this is
 * the mechanism, not an optional check.
 */
export function decryptSecret(payload: string, keyHex?: string): string {
  const key = loadKey(keyHex);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed vault payload: expected <iv>:<authTag>:<ciphertext>.");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex!, "hex");
  const authTag = Buffer.from(authTagHex!, "hex");
  const ciphertext = Buffer.from(ciphertextHex!, "hex");
  if (iv.length !== IV_BYTES || authTag.length !== 16) {
    throw new Error("Malformed vault payload: unexpected IV or auth tag length.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Constant-time-ish sanity check used only by tests to prove tamper detection is real. */
export function payloadsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// DB-backed vault operations
// ---------------------------------------------------------------------------

export interface StoreCredentialInput {
  candidateId: string;
  portal: string;
  username: string;
  /** Plaintext secret (password, API token, etc.) — encrypted before it ever
   * reaches the database or the audit log. Never logged. */
  secret: string;
  browserProfileDir?: string;
  /** Which agent/actor is storing this credential (for the audit trail). */
  actor: string;
  /** Overrides CAI_VAULT_KEY — for tests only. */
  vaultKeyHex?: string;
}

export type PortalCredentialRow = typeof portalCredentials.$inferSelect;

/**
 * Encrypts and upserts a portal credential. There is no unique DB
 * constraint on (candidateId, portal), so this looks up any existing row
 * itself and updates it in place rather than accumulating duplicates.
 */
export async function storeCredential(db: Db, input: StoreCredentialInput): Promise<PortalCredentialRow> {
  const ciphertext = encryptSecret(input.secret, input.vaultKeyHex);

  const existing = await db
    .select()
    .from(portalCredentials)
    .where(and(eq(portalCredentials.candidateId, input.candidateId), eq(portalCredentials.portal, input.portal)));

  let row: PortalCredentialRow;
  if (existing[0]) {
    const [updated] = await db
      .update(portalCredentials)
      .set({
        username: input.username,
        secretCiphertext: ciphertext,
        browserProfileDir: input.browserProfileDir ?? existing[0].browserProfileDir,
      })
      .where(eq(portalCredentials.id, existing[0].id))
      .returning();
    row = updated!;
  } else {
    const [inserted] = await db
      .insert(portalCredentials)
      .values({
        candidateId: input.candidateId,
        portal: input.portal,
        username: input.username,
        secretCiphertext: ciphertext,
        browserProfileDir: input.browserProfileDir,
      })
      .returning();
    row = inserted!;
  }

  // Audit the fact of storage — never the secret, and never the ciphertext
  // (which would still be sensitive key material to leave in the audit log).
  await recordAudit(db, {
    actor: input.actor,
    eventType: "credential.stored",
    entityType: "portal_credential",
    entityId: row.id,
    action: `Stored credential for portal "${input.portal}" (username ${input.username})`,
    evidence: { portal: input.portal, username: input.username },
  });

  return row;
}

export interface GetCredentialInput {
  candidateId: string;
  portal: string;
  /** Overrides CAI_VAULT_KEY — for tests only. */
  vaultKeyHex?: string;
}

export interface DecryptedCredential {
  id: string;
  candidateId: string;
  portal: string;
  username: string;
  secret: string;
  browserProfileDir: string | null;
  lastLoginAt: Date | null;
}

/** Decrypts and returns a stored credential, or undefined if none exists. */
export async function getCredential(db: Db, input: GetCredentialInput): Promise<DecryptedCredential | undefined> {
  const [row] = await db
    .select()
    .from(portalCredentials)
    .where(and(eq(portalCredentials.candidateId, input.candidateId), eq(portalCredentials.portal, input.portal)));
  if (!row) return undefined;

  return {
    id: row.id,
    candidateId: row.candidateId,
    portal: row.portal,
    username: row.username,
    secret: decryptSecret(row.secretCiphertext, input.vaultKeyHex),
    browserProfileDir: row.browserProfileDir,
    lastLoginAt: row.lastLoginAt,
  };
}
