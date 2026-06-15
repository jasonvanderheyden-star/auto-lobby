import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { scheduleCalendarSync, syncCalendarConnection } from "@/server/calendar/sync";
import { refreshDpohRegistry } from "@/server/dpoh-registry/registry-refresh";
import { renewalCheckCron } from "@/server/filing-engine/renewal-check";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [scheduleCalendarSync, syncCalendarConnection, refreshDpohRegistry, renewalCheckCron],
});
