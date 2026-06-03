import { InboxClient, InboxItem, WorkItem } from "@/app/inbox-client";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { isRootHost } from "@/lib/tenant-routing";
import Link from "next/link";
import { headers } from "next/headers";

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

export default async function Home() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const tenantId = headerStore.get("x-tenant-id") ?? undefined;

  if (isRootHost(host)) {
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
            <li>simulate data instantly</li>
          </ul>
        </section>
        <section className="flex flex-wrap gap-3">
          <Link
            href="/sign-up"
            className="rounded bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Sign up
          </Link>
          <Link href="/simulate" className="rounded border border-zinc-300 px-4 py-2">
            Run Simulation
          </Link>
          <Link href="https://default.canonflo.com" className="rounded border border-zinc-300 px-4 py-2">
            View Live Demo Tenant
          </Link>
        </section>
      </main>
    );
  }

  const [initialInboxItems, initialWorkItems] = await Promise.all([
    fetchInitial<InboxItem>("/items", tenantId),
    fetchInitial<WorkItem>("/work", tenantId),
  ]);

  return (
    <main className="space-y-4 p-4">
      <header className="rounded-lg border bg-white p-4">
        <h1 className="text-2xl font-semibold">Live Operations Feed</h1>
        <p className="text-sm text-zinc-600">
          Tenant-scoped real-time inbox, meaning, work, and execution.
        </p>
        <div className="mt-3 flex gap-3 text-sm">
          <Link href="/simulate" className="underline">
            Run Simulation
          </Link>
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>
        </div>
      </header>
      <InboxClient
        initialInboxItems={initialInboxItems}
        initialWorkItems={initialWorkItems}
      />
    </main>
  );
}
