"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { getTenantContext } from "@/server/tenant/context";

export async function syncCalendarNow(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const ctx = await getTenantContext();
  if (!ctx) throw new Error("No tenant context");

  const connectionId = formData.get("connectionId");
  if (typeof connectionId !== "string" || !connectionId) {
    throw new Error("Invalid connection id");
  }

  // Verify connection belongs to this tenant before queuing
  const conn = await db.calendarConnection.findFirst({
    where: { id: connectionId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!conn) throw new Error("Connection not found");

  await inngest.send({
    name: "calendar/connection.sync",
    data: { connectionId },
  });

  revalidatePath("/settings/calendars");
}
