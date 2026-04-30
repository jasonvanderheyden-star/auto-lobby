import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";

// Import all functions here as they're created — empty for now
const functions: Parameters<typeof serve>[0]["functions"] = [];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
