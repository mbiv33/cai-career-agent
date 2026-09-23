"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { escalations } from "@cai/db";
import { recordAudit } from "@cai/core";
import { withDb } from "@/lib/db";

export async function resolveEscalation(formData: FormData): Promise<void> {
  const escalationId = String(formData.get("escalationId") ?? "");
  const answer = String(formData.get("answer") ?? "").trim();

  if (!escalationId || !answer) {
    return;
  }

  await withDb(async (db) => {
    const [existing] = await db
      .select({ reason: escalations.reason })
      .from(escalations)
      .where(eq(escalations.id, escalationId))
      .limit(1);

    await db
      .update(escalations)
      .set({
        status: "RESOLVED",
        resolution: { answer, resolvedBy: "candidate" },
        resolvedAt: new Date(),
      })
      .where(eq(escalations.id, escalationId));

    await recordAudit(db, {
      actor: "candidate",
      eventType: "escalation.resolved",
      entityType: "escalation",
      entityId: escalationId,
      action: `Resolved: ${existing?.reason ?? "escalation"}`,
      reason: answer,
    });
  });

  revalidatePath("/needs-you");
  revalidatePath("/activity");
  revalidatePath("/");
}
