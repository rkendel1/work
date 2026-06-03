"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { normalizeTenantSlug, tenantDomainFromSlug } from "@/lib/tenant-routing";

type Tenant = {
  id: string;
  slug?: string;
  domain?: string;
  display_name: string;
  vertical: string;
  industry: string;
};

const SETUP_PACKS = [
  {
    vertical: "Property Management",
    industries: ["Commercial Real Estate", "Residential"],
  },
  {
    vertical: "Healthcare",
    industries: ["Clinic", "Urgent Care"],
  },
  {
    vertical: "Education",
    industries: ["K-12", "Higher Education"],
  },
  {
    vertical: "Manufacturing",
    industries: ["Discrete Manufacturing", "Process Manufacturing"],
  },
  {
    vertical: "Custom",
    industries: ["General"],
  },
];

function tenantUrl(tenant: Tenant): string {
  const slug = normalizeTenantSlug(tenant.slug || tenant.id || "default") || "default";
  const current = new URL(window.location.href);
  if (
    current.hostname === "localhost" ||
    current.hostname === "127.0.0.1" ||
    current.hostname.endsWith(".localhost")
  ) {
    const localHost = slug === "default" ? "localhost" : `${slug}.localhost`;
    const localPort = current.port ? `:${current.port}` : "";
    return `${current.protocol}//${localHost}${localPort}/`;
  }

  const host = tenantDomainFromSlug(slug);
  return `${current.protocol}//${host}/`;
}

export function OnboardingClient() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState("");
  const [tenantSubdomain, setTenantSubdomain] = useState("");
  const [tenantVertical, setTenantVertical] = useState(SETUP_PACKS[0].vertical);
  const [tenantIndustry, setTenantIndustry] = useState(SETUP_PACKS[0].industries[0]);

  const selectedSetupPack =
    useMemo(
      () => SETUP_PACKS.find((pack) => pack.vertical === tenantVertical) ?? SETUP_PACKS[0],
      [tenantVertical],
    );

  useEffect(() => {
    const loadTenants = async () => {
      try {
        const response = await fetch("/api/tenants", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to load tenants");
        }
        const tenantList = (await response.json()) as Tenant[];
        setTenants(Array.isArray(tenantList) ? tenantList : []);
      } catch {
        setError("Could not load tenants right now. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    void loadTenants();
  }, []);

  async function onCreateTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tenantName,
          slug: tenantSubdomain,
          vertical: tenantVertical,
          industry: tenantIndustry,
        }),
      });
      if (!response.ok) {
        setError(await response.text());
        return;
      }
      const tenant = (await response.json()) as Tenant;
      window.location.assign(tenantUrl(tenant));
    } catch {
      setError("Could not create tenant right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Canonflo onboarding
        </p>
        <h1 className="text-3xl font-semibold">Create or select your tenant workspace</h1>
      </header>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <section className="rounded-lg border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-3 text-lg font-semibold dark:text-zinc-100">Continue with an existing tenant</h2>
        {loading ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading tenants...</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                type="button"
                onClick={() => window.location.assign(tenantUrl(tenant))}
                className="rounded border px-3 py-2 text-left text-sm dark:border-zinc-700 dark:bg-zinc-700 dark:text-zinc-100"
              >
                {tenant.display_name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-3 text-lg font-semibold dark:text-zinc-100">Create a new tenant</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {SETUP_PACKS.map((pack) => (
            <button
              key={pack.vertical}
              type="button"
              onClick={() => {
                setTenantVertical(pack.vertical);
                setTenantIndustry(pack.industries[0]);
              }}
              className={`rounded border px-3 py-1 text-sm dark:border-zinc-700 ${
                tenantVertical === pack.vertical
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-white dark:bg-zinc-700 dark:text-zinc-100"
              }`}
            >
              {pack.vertical}
            </button>
          ))}
        </div>

        <form onSubmit={onCreateTenant} className="grid gap-2 md:grid-cols-2">
          <input
            value={tenantName}
            onChange={(event) => setTenantName(event.target.value)}
            className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
            placeholder="Organization Name"
            required
          />
          <input
            value={tenantSubdomain}
            onChange={(event) => setTenantSubdomain(event.target.value)}
            className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
            placeholder="Subdomain (e.g. acme)"
            required
          />
          <input
            value={tenantVertical}
            className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
            readOnly
          />
          <select
            value={tenantIndustry}
            onChange={(event) => setTenantIndustry(event.target.value)}
            className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
          >
            {selectedSetupPack.industries.map((industry) => (
              <option key={industry} value={industry}>
                {industry}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {submitting ? "Creating..." : "Create Tenant"}
          </button>
        </form>
      </section>
    </main>
  );
}
