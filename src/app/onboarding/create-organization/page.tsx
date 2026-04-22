import { CreateOrganization } from "@clerk/nextjs";

export const metadata = { title: "Create Organization — Auto Lobby" };

export default function CreateOrganizationPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-50 px-4">
      <div className="mb-2 text-center">
        <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-emerald-600 to-teal-700 text-sm font-bold text-white">
          AL
        </div>
        <h1 className="text-xl font-semibold text-stone-900">Set up your organization</h1>
        <p className="mt-1 text-sm text-stone-500">
          Every account belongs to an organization. Create yours to continue.
        </p>
      </div>
      <CreateOrganization afterCreateOrganizationUrl="/dashboard" />
    </div>
  );
}
