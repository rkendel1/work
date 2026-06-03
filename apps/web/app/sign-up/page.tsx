"use client";

import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  const clerkConfigured =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.includes("replace-with") &&
    (process.env.NODE_ENV !== "development" ||
      process.env.NEXT_PUBLIC_ENABLE_CLERK_IN_DEV === "true");

  if (!clerkConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-16 text-center text-sm text-zinc-600 dark:text-zinc-400">
        Configure Clerk environment variables to enable sign up.
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <SignUp path="/sign-up" signInUrl="/sign-in" />
    </main>
  );
}
