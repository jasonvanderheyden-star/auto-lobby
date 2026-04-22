import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Routes that do NOT require authentication.
// Everything else (including /registry-search) is protected — Clerk will
// redirect unauthenticated requests to /sign-in automatically.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/(.*)", // Clerk + future integrations
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js static assets and internal paths.
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
    "/(api|trpc)(.*)",
  ],
};
