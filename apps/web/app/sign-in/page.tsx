"use client";

import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  const clerkConfigured =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.includes("replace-with");

  if (!clerkConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-16 text-center text-sm text-zinc-600 dark:text-zinc-400">
        Configure Clerk environment variables to enable sign in.
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <SignIn path="/sign-in" signUpUrl="/sign-up" />
    </main>
  );
}
