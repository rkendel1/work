import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkConfigured =
    clerkPublishableKey &&
    /^pk_(test|live)_[A-Za-z0-9_-]+$/.test(clerkPublishableKey) &&
    (process.env.NODE_ENV !== "development" ||
      process.env.NEXT_PUBLIC_ENABLE_CLERK_IN_DEV === "true");

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
