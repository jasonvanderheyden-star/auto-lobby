"use client";

import { OrganizationSwitcher } from "@clerk/nextjs";

export function OrgSwitcher() {
  return (
    <OrganizationSwitcher
      afterCreateOrganizationUrl="/dashboard"
      afterSelectOrganizationUrl="/dashboard"
      afterLeaveOrganizationUrl="/onboarding/create-organization"
      appearance={{
        elements: {
          rootBox: "flex items-center",
        },
      }}
    />
  );
}
