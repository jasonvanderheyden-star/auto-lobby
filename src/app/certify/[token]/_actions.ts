"use server";

/**
 * Server action for the routed-certification page (/certify/[token]).
 *
 * No Clerk auth — the single-use routing token IS the authorization.
 * Everything is re-verified server-side: token hash, expiry, uncertified
 * status. Non-negotiable #1: the RO types their full name, checks the
 * attestation box, and clicks Certify — nothing auto-certifies.
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/server/audit-log/append";
import {
  findRoutedBatchByToken,
  hashRoutingToken,
} from "@/server/filing-engine/route-for-certification";

export interface CertifyRoutedState {
  status: "idle" | "success" | "error";
  message?: string;
  count?: number;
  monthLabel?: string;
}

const inputSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{20,}$/, "Invalid token"),
  typedName: z
    .string()
    .trim()
    .min(3, "Please type your full legal name")
    .max(200),
  attested: z.literal("on", {
    error: "You must check the attestation box",
  }),
});

export async function certifyRoutedBatchAction(
  _prev: CertifyRoutedState,
  formData: FormData,
): Promise<CertifyRoutedState> {
  const parsed = inputSchema.safeParse({
    token: formData.get("token"),
    typedName: formData.get("typedName"),
    attested: formData.get("attested"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { token, typedName } = parsed.data;

  // Re-verify the token server-side — hash match, un-expired, un-certified.
  const batch = await findRoutedBatchByToken(token);
  if (!batch) {
    return {
      status: "error",
      message:
        "This certification link is no longer valid — it may have expired, been revoked, or already been used.",
    };
  }

  const routingTokenHash = hashRoutingToken(token);
  const now = new Date();
  const draftIds = batch.drafts.map((d) => d.id);

  try {
    await db.$transaction(async (tx) => {
      // Conditional update keyed on the hash — concurrent double-submit of the
      // same token certifies at most once (the second run matches 0 rows).
      const result = await tx.draftMcr.updateMany({
        where: {
          id: { in: draftIds },
          routingTokenHash, // still routed — not revoked or re-routed meanwhile
          routingTokenExpiresAt: { gt: now },
          certifiedAt: null,
        },
        data: {
          certifiedAt: now,
          certifiedByUserId: null, // RO certified via routed link, no app account
          routingTokenHash: null, // single use — link dies here
          routingTokenExpiresAt: null,
        },
      });
      if (result.count === 0) {
        throw new Error("ROUTING_TOKEN_CONSUMED");
      }

      await appendAuditEvent({
        tenantId: batch.tenant.id,
        actor: batch.routedToEmail, // email the batch was routed to
        actorRole: "registrant",
        action: "batch-certified",
        subject: batch.tenant.id,
        payload: {
          via: "routed-link",
          typedName,
          routedToEmail: batch.routedToEmail,
          month: batch.month,
          count: result.count,
          draftMcrIds: draftIds,
        },
        tx,
      });
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "ROUTING_TOKEN_CONSUMED") {
      return {
        status: "error",
        message:
          "This certification link was already used or has been revoked. If you believe this is a mistake, contact the firm that sent you the link.",
      };
    }
    throw err;
  }

  const [year, mon] = batch.month.split("-").map(Number) as [number, number];
  const monthLabel = new Date(Date.UTC(year, mon - 1, 1)).toLocaleString(
    "en-CA",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return {
    status: "success",
    count: batch.drafts.length,
    monthLabel,
    message: `Certified ${batch.drafts.length} Monthly Communication Report${batch.drafts.length === 1 ? "" : "s"} for ${monthLabel}.`,
  };
}
