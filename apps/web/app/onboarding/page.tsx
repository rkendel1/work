import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isRootHost } from "@/lib/tenant-routing";
import { OnboardingClient } from "@/app/onboarding/onboarding-client";

export default async function OnboardingPage() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const authBypassEnabled = process.env.NEXT_PUBLIC_ENABLE_AUTH_BYPASS === "true";
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkConfigured = Boolean(
    clerkPublishableKey &&
      /^pk_(test|live)_[A-Za-z0-9_-]+$/.test(clerkPublishableKey) &&
      (process.env.NODE_ENV !== "development" ||
        process.env.NEXT_PUBLIC_ENABLE_CLERK_IN_DEV === "true"),
  );

  if (!isRootHost(host)) {
    redirect("/");
  }

  let userIdentifier: string | null = null;
  if (clerkConfigured && !authBypassEnabled) {
    const { userId } = await auth();
    if (!userId) {
      redirect("/sign-in");
    }
    const user = await currentUser();
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
    userIdentifier =
      user?.primaryEmailAddress?.emailAddress ??
      (fullName || null) ??
      user?.username ??
      userId;
  }

  return <OnboardingClient userIdentifier={userIdentifier} />;
}
