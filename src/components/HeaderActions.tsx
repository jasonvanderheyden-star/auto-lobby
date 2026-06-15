"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

/**
 * Right-aligned header controls: Clerk organization switcher (lets a user
 * switch between tenant workspaces and create new organizations) plus the
 * user/sign-out menu. Rendered in the empty right slot of each page header.
 */
export function HeaderActions() {
  return (
    <div className="flex items-center gap-3">
      <OrganizationSwitcher
        afterSelectOrganizationUrl="/dashboard"
        afterCreateOrganizationUrl="/dashboard"
        afterLeaveOrganizationUrl="/onboarding/create-organization"
        appearance={{ elements: { rootBox: "flex items-center" } }}
      />
      <UserButton />
    </div>
  );
}
