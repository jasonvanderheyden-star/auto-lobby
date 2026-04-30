import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { scheduleCalendarSync, syncCalendarConnection } from "@/server/calendar/sync";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [scheduleCalendarSync, syncCalendarConnection],
});
