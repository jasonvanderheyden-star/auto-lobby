import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign In — Auto Lobby" };

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="flex flex-col items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-emerald-600 to-teal-700 text-sm font-bold text-white">
            AL
          </div>
          <span className="text-lg font-semibold text-stone-900">Auto Lobby</span>
        </div>
        <SignIn fallbackRedirectUrl="/dashboard" />
      </div>
    </div>
  );
}
