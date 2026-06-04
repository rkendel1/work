import { InboxClient, InboxItem, WorkItem } from "@/app/inbox-client";
import { SessionUserControls } from "@/components/session-user-controls";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { isRootHost, tenantSlugFromHost } from "@/lib/tenant-routing";
import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

type Tenant = {
  id?: string;
  slug?: string;
  name?: string;
  display_name?: string;
};

function titleCaseFromSlug(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

async function fetchInitial<T>(path: string, tenantId?: string): Promise<T[]> {
  try {
    const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    const response = await fetch(`${RUST_INGRESS_URL}${path}${query}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return (await response.json()) as T[];
  } catch {
    return [];
  }
}

async function resolveTenantName(tenantId?: string, tenantSlug?: string | null): Promise<string> {
  const fallbackSource = tenantSlug || tenantId || "default";
  const fallbackName = titleCaseFromSlug(fallbackSource) || "Default Tenant";

  try {
    const response = await fetch(`${RUST_INGRESS_URL}/tenants`, { cache: "no-store" });
    if (!response.ok) {
      return fallbackName;
    }

    const tenants = (await response.json()) as Tenant[];
    if (!Array.isArray(tenants) || tenants.length === 0) {
      return fallbackName;
    }

    const matchingTenant = tenants.find((tenant) => {
      if (tenantId && tenant.id === tenantId) {
        return true;
      }
      if (tenantSlug && (tenant.slug === tenantSlug || tenant.id === tenantSlug)) {
        return true;
      }
      return false;
    });

    return matchingTenant?.display_name || matchingTenant?.name || fallbackName;
  } catch {
    return fallbackName;
  }
}

export default async function Home() {
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
  const { userId } =
    clerkConfigured && !authBypassEnabled ? await auth() : { userId: null };
  const tenantSlug = tenantSlugFromHost(host);
  const tenantId =
    headerStore.get("x-tenant-id") ??
    (authBypassEnabled && !tenantSlug ? "default" : undefined);

  if (clerkConfigured && !authBypassEnabled && userId && isRootHost(host)) {
    redirect("/onboarding");
  }

  if (clerkConfigured && !authBypassEnabled && !userId && tenantSlug) {
    redirect("/sign-in");
  }

  if (!tenantSlug && !authBypassEnabled) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-8 px-6 py-20">
        <section className="space-y-4">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Canonflo Operations
          </p>
          <h1 className="text-4xl font-semibold">
            See your operations in real time from your first signal.
          </h1>
          <ul className="list-disc space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
            <li>connect inbox</li>
            <li>forward email</li>
            <li>ingest webhook</li>
            <li>inject scenario signals instantly</li>
          </ul>
        </section>
        <section className="flex flex-wrap gap-3">
          <Link
            href="/sign-up"
            className="rounded bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Sign up
          </Link>
          <Link href="/sign-in" className="rounded border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
            Sign in
          </Link>
          {clerkConfigured && !userId ? null : (
            <Link href="/onboarding" className="rounded border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
              Onboarding
            </Link>
          )}
          <Link href="/simulate" className="rounded border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
            Inject Scenario
          </Link>
          <Link href="/demo-admin" className="rounded border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
            Demo Admin
          </Link>
          <Link href="/" className="rounded border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
            View Live Feed
          </Link>
        </section>
      </main>
    );
  }

  const [initialInboxItems, initialWorkItems] = await Promise.all([
    fetchInitial<InboxItem>("/items", tenantId),
    fetchInitial<WorkItem>("/work", tenantId),
  ]);
  const tenantName = await resolveTenantName(tenantId, tenantSlug);
  let userIdentifier: string | null = null;
  if (clerkConfigured && !authBypassEnabled && userId) {
    const user = await currentUser();
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
    userIdentifier =
      user?.primaryEmailAddress?.emailAddress ??
      (fullName || null) ??
      user?.username ??
      userId;
  }

  return (
    <main className="space-y-4 p-4">
      <header className="rounded-lg border bg-white p-4 dark:bg-zinc-800 dark:border-zinc-700">
        <h1 className="text-2xl font-semibold">Live Operations Stream</h1>
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Tenant: {tenantName}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tenant-scoped continuous operational stream with meaning and action layers.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <Link href="/simulate" className="underline dark:text-zinc-300">
            Scenario Injection
          </Link>
          {userIdentifier ? (
            <SessionUserControls userIdentifier={userIdentifier} />
          ) : (
            <Link href="/sign-in" className="underline dark:text-zinc-300">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <InboxClient
        initialInboxItems={initialInboxItems}
        initialWorkItems={initialWorkItems}
      />
    </main>
  );
}
