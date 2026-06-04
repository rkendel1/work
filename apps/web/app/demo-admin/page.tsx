"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  displayName?: string;
  domain: string;
  vertical?: string;
  industry?: string;
};

type Vertical = {
  name: string;
};

type Industry = {
  vertical: string;
  name: string;
};

type CatalogResponse = {
  tenants: Tenant[];
  verticals: Vertical[];
  industries: Industry[];
};

async function adminAction(payload: Record<string, unknown>) {
  const response = await fetch("/api/demo-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? "Request failed");
  }
}

export default function DemoAdminPage() {
  const [catalog, setCatalog] = useState<CatalogResponse>({ tenants: [], verticals: [], industries: [] });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantVertical, setTenantVertical] = useState("Property Management");
  const [tenantIndustry, setTenantIndustry] = useState("Commercial Real Estate");

  const [newVertical, setNewVertical] = useState("");
  const [industryVertical, setIndustryVertical] = useState("Property Management");
  const [newIndustry, setNewIndustry] = useState("");

  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDomain, setEditDomain] = useState("");
  const [editVertical, setEditVertical] = useState("");
  const [editIndustry, setEditIndustry] = useState("");
  const [seedEmail, setSeedEmail] = useState("");

  const selectedTenant = useMemo(
    () => catalog.tenants.find((tenant) => tenant.id === selectedTenantId) ?? null,
    [catalog.tenants, selectedTenantId],
  );

  async function loadCatalog() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/demo-admin", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load admin catalog");
      }
      const payload = (await response.json()) as CatalogResponse;
      const nextCatalog = {
        tenants: Array.isArray(payload.tenants) ? payload.tenants : [],
        verticals: Array.isArray(payload.verticals) ? payload.verticals : [],
        industries: Array.isArray(payload.industries) ? payload.industries : [],
      };
      setCatalog(nextCatalog);

      if (nextCatalog.tenants.length > 0) {
        const firstTenant = nextCatalog.tenants[0];
        setSelectedTenantId((previous) => previous || firstTenant.id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (!selectedTenant) {
      return;
    }
    setEditDisplayName(selectedTenant.displayName ?? selectedTenant.name);
    setEditDomain(selectedTenant.domain ?? "");
    setEditVertical(selectedTenant.vertical ?? "");
    setEditIndustry(selectedTenant.industry ?? "");
    setSeedEmail(`demo.operator+${selectedTenant.id}@canonflo.local`);
  }, [selectedTenant]);

  async function submitCreateTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus("Creating tenant...");
    try {
      await adminAction({
        action: "createTenant",
        name: tenantName,
        slug: tenantSlug,
        vertical: tenantVertical,
        industry: tenantIndustry,
      });
      setStatus("Tenant created.");
      setTenantName("");
      setTenantSlug("");
      await loadCatalog();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create tenant");
      setStatus(null);
    }
  }

  async function submitNewVertical(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus("Adding vertical...");
    try {
      await adminAction({ action: "addVertical", name: newVertical });
      setStatus("Vertical added.");
      setNewVertical("");
      await loadCatalog();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to add vertical");
      setStatus(null);
    }
  }

  async function submitNewIndustry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus("Adding industry...");
    try {
      await adminAction({ action: "addIndustry", vertical: industryVertical, name: newIndustry });
      setStatus("Industry added.");
      setNewIndustry("");
      await loadCatalog();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to add industry");
      setStatus(null);
    }
  }

  async function submitTenantUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenantId) {
      return;
    }
    setError(null);
    setStatus("Updating tenant...");
    try {
      await adminAction({
        action: "updateTenant",
        tenantId: selectedTenantId,
        displayName: editDisplayName,
        domain: editDomain,
        vertical: editVertical,
        industry: editIndustry,
      });
      setStatus("Tenant updated.");
      await loadCatalog();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to update tenant");
      setStatus(null);
    }
  }

  async function seedTenant(tenantId: string) {
    setError(null);
    setStatus(`Seeding ${tenantId}...`);
    try {
      await adminAction({
        action: "seedTenant",
        tenantId,
        userEmail: tenantId === selectedTenantId ? seedEmail : undefined,
      });
      setStatus(`Seed completed for ${tenantId}.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to seed tenant");
      setStatus(null);
    }
  }

  const verticalOptions = catalog.verticals.map((vertical) => vertical.name);
  const industriesByVertical = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const industry of catalog.industries) {
      const existing = map.get(industry.vertical) ?? [];
      existing.push(industry.name);
      map.set(industry.vertical, existing.sort((left, right) => left.localeCompare(right)));
    }
    return map;
  }, [catalog.industries]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Simulator Demo Admin</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Public admin tooling for demo tenant setup, vertical/industry catalog management, and simulator seeding.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/simulate" className="underline">
            Open simulator
          </Link>
        </div>
      </header>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {status ? <p className="text-sm text-zinc-600 dark:text-zinc-300">{status}</p> : null}

      <section className="rounded-lg border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-3 text-lg font-semibold">Create tenant</h2>
        <form className="grid gap-2 md:grid-cols-2" onSubmit={submitCreateTenant}>
          <input
            required
            value={tenantName}
            onChange={(event) => setTenantName(event.target.value)}
            className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            placeholder="Tenant name"
          />
          <input
            required
            value={tenantSlug}
            onChange={(event) => setTenantSlug(event.target.value)}
            className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            placeholder="Slug (e.g. northstar-facilities)"
          />
          <input
            value={tenantVertical}
            onChange={(event) => setTenantVertical(event.target.value)}
            list="vertical-options"
            className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            placeholder="Vertical"
          />
          <input
            value={tenantIndustry}
            onChange={(event) => setTenantIndustry(event.target.value)}
            list="industry-options-create"
            className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            placeholder="Industry"
          />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Create tenant
          </button>
        </form>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-lg font-semibold">Add vertical</h2>
          <form onSubmit={submitNewVertical} className="flex gap-2">
            <input
              value={newVertical}
              onChange={(event) => setNewVertical(event.target.value)}
              className="w-full rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
              placeholder="Vertical name"
              required
            />
            <button
              type="submit"
              className="rounded border px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            >
              Add
            </button>
          </form>
        </div>
        <div className="rounded-lg border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-lg font-semibold">Add industry</h2>
          <form onSubmit={submitNewIndustry} className="grid gap-2">
            <input
              list="vertical-options"
              value={industryVertical}
              onChange={(event) => setIndustryVertical(event.target.value)}
              className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
              placeholder="Vertical"
              required
            />
            <input
              value={newIndustry}
              onChange={(event) => setNewIndustry(event.target.value)}
              className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
              placeholder="Industry name"
              required
            />
            <button
              type="submit"
              className="rounded border px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            >
              Add
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-3 text-lg font-semibold">Maintain tenant info</h2>
        {loading ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading catalog...</p>
        ) : (
          <div className="grid gap-4">
            <select
              value={selectedTenantId}
              onChange={(event) => setSelectedTenantId(event.target.value)}
              className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            >
              {catalog.tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.displayName ?? tenant.name} ({tenant.id})
                </option>
              ))}
              {catalog.tenants.length === 0 ? <option value="">No tenants yet</option> : null}
            </select>

            <form onSubmit={submitTenantUpdate} className="grid gap-2 md:grid-cols-2">
              <input
                value={editDisplayName}
                onChange={(event) => setEditDisplayName(event.target.value)}
                className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                placeholder="Display name"
                required
              />
              <input
                value={editDomain}
                onChange={(event) => setEditDomain(event.target.value)}
                className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                placeholder="Domain"
                required
              />
              <input
                list="vertical-options"
                value={editVertical}
                onChange={(event) => setEditVertical(event.target.value)}
                className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                placeholder="Vertical"
              />
              <input
                value={editIndustry}
                onChange={(event) => setEditIndustry(event.target.value)}
                list="industry-options"
                className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                placeholder="Industry"
              />
              <button
                type="submit"
                disabled={!selectedTenantId}
                className="rounded bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Save tenant info
              </button>
            </form>

            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                value={seedEmail}
                onChange={(event) => setSeedEmail(event.target.value)}
                className="rounded border px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                placeholder="Seed operator email"
              />
              <button
                type="button"
                disabled={!selectedTenantId}
                onClick={() => void seedTenant(selectedTenantId)}
                className="rounded border px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 disabled:opacity-50"
              >
                Seed selected tenant
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-2 text-lg font-semibold">Catalog snapshot</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tenants: {catalog.tenants.length} • Verticals: {catalog.verticals.length} • Industries: {catalog.industries.length}
        </p>
        {catalog.tenants.length > 0 ? (
          <ul className="mt-3 grid gap-2 text-sm">
            {catalog.tenants.map((tenant) => (
              <li key={tenant.id} className="rounded border p-2 dark:border-zinc-700">
                <p className="font-medium">{tenant.displayName ?? tenant.name}</p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {tenant.id} • {tenant.vertical ?? "General"} / {tenant.industry ?? "General"} • {tenant.domain}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <datalist id="vertical-options">
        {verticalOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="industry-options">
        {(industriesByVertical.get(editVertical) ?? []).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="industry-options-create">
        {(industriesByVertical.get(tenantVertical) ?? []).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </main>
  );
}
