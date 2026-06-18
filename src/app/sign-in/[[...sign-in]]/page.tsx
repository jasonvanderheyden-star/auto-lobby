import { SignIn } from "@clerk/nextjs";
import { BrandTile } from "@/components/Brand";

export const metadata = { title: "Sign In — Auto Lobby" };

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="flex flex-col items-center gap-6">
        <div className="flex items-center gap-2">
          <BrandTile size={32} />
          <span className="text-lg font-semibold text-stone-900">Auto Lobby</span>
        </div>
        <SignIn fallbackRedirectUrl="/dashboard" />
      </div>
    </div>
  );
}
