"use server";

/**
 * Server actions for the agency workspace (/agency).
 *
 * Guard model: the signed-in Clerk user must be an AgencyMember (admin or
 * staff) of the agency that manages the target tenant. Consultants route
 * nothing here — they certify their own consultant MCRs (separate flow).
 *
 * The raw routing token is returned to the caller ONCE and never persisted
 * or logged — only its SHA-256 hash lives in the DB.
 */

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/server/tenant/roles";
import {
  revokeRouting,
  routeBatchForCertification,
} from "@/server/filing-engine/route-for-certification";
import {
  assertEntitled,
  EntitlementError,
} from "@/server/entitlements/entitlements";

export interface RouteForCertificationState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Relative certification URL — shown exactly once, never stored. */
  certificationPath?: string;
  count?: number;
  expiresAt?: string; // ISO
}

const routeFormSchema = z.object({
  tenantId: z.string().min(1),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month"),
  routedToEmail: z.string().email("Enter the Responsible Officer's email"),
});

type AgencyActor = {
  userId: string;
  role: "admin" | "staff";
};

/**
 * Resolves + authorizes the acting user as an admin/staff AgencyMember of
 * the agency managing `tenantId`. Throws ForbiddenError otherwise.
 */
async function requireAgencyActorForTenant(
  tenantId: string,
): Promise<AgencyActor> {
  const { userId } = await auth();
  if (!userId) throw new ForbiddenError("Not signed in");

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, agencyId: true },
  });
  if (!tenant?.agencyId) {
    throw new ForbiddenError("This tenant is not managed by an agency");
  }

  const member = await db.agencyMember.findFirst({
    where: {
      agencyId: tenant.agencyId,
      clerkUserId: userId,
      role: { in: ["admin", "staff"] },
    },
    select: { role: true },
  });
  if (!member) {
    throw new ForbiddenError(
      "Routing for certification requires agency admin or staff membership for this client",
    );
  }

  return { userId, role: member.role === "admin" ? "admin" : "staff" };
}

export async function routeForCertificationAction(
  _prev: RouteForCertificationState,
  formData: FormData,
): Promise<RouteForCertificationState> {
  const parsed = routeFormSchema.safeParse({
    tenantId: formData.get("tenantId"),
    month: formData.get("month"),
    routedToEmail: formData.get("routedToEmail"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { tenantId, month, routedToEmail } = parsed.data;

  let actor: AgencyActor;
  try {
    actor = await requireAgencyActorForTenant(tenantId);
    // Revenue gate: the managed client tenant must be entitled to Auto Lobby.
    await assertEntitled(tenantId, "lobbying_compliance");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof EntitlementError) {
      return { status: "error", message: err.message };
    }
    throw err;
  }

  const result = await routeBatchForCertification({
    tenantId,
    month,
    routedToEmail,
    routedByUserId: actor.userId,
    onBehalfOf: {
      actorRole: actor.role === "admin" ? "agency-admin" : "agency-staff",
    },
  });

  if (!result.ok) {
    return {
      status: "error",
      message: `No certifiable draft MCRs for ${month} — nothing to route.`,
    };
  }

  revalidatePath("/agency");

  // TODO(transactional-email): send this link to the RO directly once email
  // infra lands. Until then the staffer copies it into their own email.
  return {
    status: "success",
    certificationPath: `/certify/${result.rawToken}`,
    count: result.count,
    expiresAt: result.expiresAt.toISOString(),
    message: `Routed ${result.count} draft${result.count === 1 ? "" : "s"} for certification.`,
  };
}

const revokeFormSchema = z.object({
  tenantId: z.string().min(1),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export async function revokeRoutingAction(formData: FormData): Promise<void> {
  const { tenantId, month } = revokeFormSchema.parse({
    tenantId: formData.get("tenantId"),
    month: formData.get("month"),
  });

  const actor = await requireAgencyActorForTenant(tenantId);

  await revokeRouting({
    tenantId,
    month,
    revokedByUserId: actor.userId,
    actorRole: actor.role === "admin" ? "agency-admin" : "agency-staff",
  });

  revalidatePath("/agency");
}
