/**
 * DB-backed vault tests: proves storeCredential/getCredential round-trip via
 * `portal_credentials`, that only ciphertext ever reaches the row, and that
 * storing an audit event happens without ever including the plaintext secret.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, portalCredentials } from "@cai/db";
import { generateVaultKey, getCredential, storeCredential } from "./vault.js";
import { cleanupTestCandidate, createTestCandidate, db, type TestCandidate } from "./test-db.js";

describe("storeCredential / getCredential (live DB)", () => {
  let candidate: TestCandidate;
  const vaultKeyHex = generateVaultKey();

  beforeAll(async () => {
    candidate = await createTestCandidate("vault");
  });

  afterAll(async () => {
    await cleanupTestCandidate(candidate);
  });

  it("stores an encrypted credential and decrypts it back to the original secret", async () => {
    const row = await storeCredential(db, {
      candidateId: candidate.candidateId,
      portal: "workday:acme",
      username: "cai@example.com",
      secret: "sup3r-s3cret-p@ssw0rd",
      actor: "test",
      vaultKeyHex,
    });

    expect(row.secretCiphertext).not.toContain("sup3r-s3cret-p@ssw0rd");

    const [raw] = await db.select().from(portalCredentials).where(eq(portalCredentials.id, row.id));
    expect(raw?.secretCiphertext).not.toContain("sup3r-s3cret-p@ssw0rd");

    const decrypted = await getCredential(db, {
      candidateId: candidate.candidateId,
      portal: "workday:acme",
      vaultKeyHex,
    });
    expect(decrypted?.secret).toBe("sup3r-s3cret-p@ssw0rd");
    expect(decrypted?.username).toBe("cai@example.com");
  });

  it("records a credential.stored audit event without the plaintext secret", async () => {
    const row = await storeCredential(db, {
      candidateId: candidate.candidateId,
      portal: "greenhouse",
      username: "cai@example.com",
      secret: "another-secret-value",
      actor: "test",
      vaultKeyHex,
    });

    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, row.id));

    expect(audit?.eventType).toBe("credential.stored");
    expect(JSON.stringify(audit?.evidence ?? {})).not.toContain("another-secret-value");
    expect(JSON.stringify(audit ?? {})).not.toContain("another-secret-value");
  });

  it("upserts in place — re-storing the same (candidate, portal) updates rather than duplicates", async () => {
    await storeCredential(db, {
      candidateId: candidate.candidateId,
      portal: "linkedin",
      username: "cai@example.com",
      secret: "first-secret",
      actor: "test",
      vaultKeyHex,
    });
    await storeCredential(db, {
      candidateId: candidate.candidateId,
      portal: "linkedin",
      username: "cai@example.com",
      secret: "second-secret",
      actor: "test",
      vaultKeyHex,
    });

    const rows = await db.select().from(portalCredentials).where(eq(portalCredentials.candidateId, candidate.candidateId));
    const linkedinRows = rows.filter((r) => r.portal === "linkedin");
    expect(linkedinRows).toHaveLength(1);

    const decrypted = await getCredential(db, {
      candidateId: candidate.candidateId,
      portal: "linkedin",
      vaultKeyHex,
    });
    expect(decrypted?.secret).toBe("second-secret");
  });

  it("returns undefined for a portal with no stored credential", async () => {
    const result = await getCredential(db, {
      candidateId: candidate.candidateId,
      portal: "no-such-portal",
      vaultKeyHex,
    });
    expect(result).toBeUndefined();
  });
});
