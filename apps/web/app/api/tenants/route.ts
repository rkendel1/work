import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { runConvexAdminMutation, runConvexAdminQuery } from "@/lib/convex-admin";
import { normalizeTenantSlug, tenantDomainFromSlug } from "@/lib/tenant-routing";

function requestHost(request: Request): string {
  return (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host
  );
}

const SIMULATION_TENANT_BLUEPRINTS = [
  {
    slug: "northstar-facilities",
    name: "Northstar Facilities",
    vertical: "Property Management",
    industry: "Commercial Real Estate",
  },
  {
    slug: "harbor-clinic-ops",
    name: "Harbor Clinic Ops",
    vertical: "Healthcare",
    industry: "Clinic",
  },
  {
    slug: "relay-logistics-hub",
    name: "Relay Logistics Hub",
    vertical: "Logistics",
    industry: "Freight & Distribution",
  },
] as const;

type TenantRecord = {
  id: string;
  slug: string;
  domain: string;
  name: string;
  display_name?: string;
  displayName?: string;
  vertical?: string;
  industry?: string;
  created_at?: number;
  createdAt?: number;
};

function tenantSlugFromRecord(tenant: TenantRecord) {
  return normalizeTenantSlug(tenant.slug || tenant.id) || "default";
}

function normalizeTenantRecord(tenant: TenantRecord, host: string): TenantRecord {
  const slug = tenantSlugFromRecord(tenant);
  const name = tenant.name?.trim() || tenant.displayName?.trim() || tenant.display_name?.trim() || slug;
  return {
    ...tenant,
    id: tenant.id || slug,
    slug,
    name,
    display_name: tenant.displayName ?? tenant.display_name ?? name,
    domain: tenantDomainFromSlug(slug, host),
    created_at: tenant.createdAt ?? tenant.created_at ?? Math.floor(Date.now() / 1000),
  };
}

async function fetchIngressTenants() {
  const response = await fetch(`${RUST_INGRESS_URL}/tenants`, { cache: "no-store" });
  return response;
}

async function fetchConvexTenants() {
  try {
    const tenants = await runConvexAdminQuery<TenantRecord[]>("actions:listTenants", {});
    return Array.isArray(tenants) ? tenants : [];
  } catch {
    return [];
  }
}

function mergeTenantLists(host: string, ingressTenants: TenantRecord[], convexTenants: TenantRecord[]) {
  const byKey = new Map<string, TenantRecord>();
  for (const tenant of [...ingressTenants, ...convexTenants]) {
    const normalized = normalizeTenantRecord(tenant, host);
    const key = normalized.id || normalized.slug;
    if (!key) {
      continue;
    }
    byKey.set(key, normalized);
  }
  return Array.from(byKey.values()).sort((left, right) =>
    (left.display_name ?? left.name).localeCompare(right.display_name ?? right.name),
  );
}

async function persistTenantToConvex(tenant: TenantRecord) {
  await runConvexAdminMutation("actions:createTenant", {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    domain: tenant.domain,
    displayName: tenant.display_name ?? tenant.displayName ?? tenant.name,
    vertical: tenant.vertical,
    industry: tenant.industry,
    createdAt: tenant.created_at ?? tenant.createdAt ?? Math.floor(Date.now() / 1000),
  });
}

async function ensureSimulationTenantBlueprints(tenants: TenantRecord[]) {
  const existingSlugs = new Set(tenants.map(tenantSlugFromRecord));
  const missingBlueprints = SIMULATION_TENANT_BLUEPRINTS.filter((tenant) => !existingSlugs.has(tenant.slug));
  if (missingBlueprints.length === 0) {
    return;
  }

  await Promise.all(
    missingBlueprints.map((tenant) =>
      fetch(`${RUST_INGRESS_URL}/tenants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tenant),
      }).catch(() => null),
    ),
  );
}

function simulationFallbackAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_AUTH_BYPASS === "true";
}

type CreateTenantPayload = {
  name?: unknown;
  slug?: unknown;
  subdomain?: unknown;
  vertical?: unknown;
  industry?: unknown;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function simulationTenantFromPayload(payload: unknown, host: string) {
  const candidate = (payload ?? {}) as CreateTenantPayload;
  const name = asTrimmedString(candidate.name) ?? "New Tenant";
  const rawSlug = asTrimmedString(candidate.slug) ?? asTrimmedString(candidate.subdomain) ?? name;
  const slug = normalizeTenantSlug(rawSlug) || "default";
  const vertical = asTrimmedString(candidate.vertical) ?? "Property Management";
  const industry = asTrimmedString(candidate.industry) ?? "Commercial Real Estate";

  return {
    id: slug,
    slug,
    domain: tenantDomainFromSlug(slug, host),
    name,
    display_name: name,
    vertical,
    industry,
    created_at: Math.floor(Date.now() / 1000),
  };
}

export async function GET(request: Request) {
  const host = requestHost(request);
  try {
    const response = await fetchIngressTenants();
    if (!response.ok) {
      const convexTenants = await fetchConvexTenants();
      if (convexTenants.length > 0) {
        return NextResponse.json(
          mergeTenantLists(host, [], convexTenants),
          { status: 200 },
        );
      }
      return NextResponse.json({ error: "Failed to load tenants" }, { status: response.status });
    }

    const loadedTenants = (await response.json()) as unknown;
    if (!Array.isArray(loadedTenants)) {
      return NextResponse.json([], { status: 200 });
    }

    const tenants = loadedTenants as TenantRecord[];
    await ensureSimulationTenantBlueprints(tenants);

    const refreshed = await fetchIngressTenants();
    if (!refreshed.ok) {
      return NextResponse.json(tenants.map((tenant) => normalizeTenantRecord(tenant, host)), { status: 200 });
    }

    const refreshedTenants = (await refreshed.json()) as unknown;
    const ingressNormalized = (Array.isArray(refreshedTenants) ? refreshedTenants : []).map((tenant) =>
      normalizeTenantRecord(tenant as TenantRecord, host),
    );
    const convexTenants = await fetchConvexTenants();
    const normalized = mergeTenantLists(host, ingressNormalized, convexTenants);
    return NextResponse.json(normalized, { status: 200 });
  } catch {
    const convexTenants = await fetchConvexTenants();
    if (convexTenants.length > 0) {
      return NextResponse.json(mergeTenantLists(host, [], convexTenants), { status: 200 });
    }
    if (simulationFallbackAllowed()) {
      return NextResponse.json([], { status: 200 });
    }
    return NextResponse.json({ error: "Failed to load tenants" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const host = requestHost(request);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    const response = await fetch(`${RUST_INGRESS_URL}/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok && response.status >= 500) {
      const tenant = simulationTenantFromPayload(payload, host);
      try {
        await persistTenantToConvex(tenant);
      } catch {}
      return NextResponse.json(tenant, { status: 201 });
    }

    const body = await response.text();
    if (!response.ok) {
      return new NextResponse(body, {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const tenant = JSON.parse(body) as TenantRecord;
    await persistTenantToConvex(tenant);

    const { userId } = await auth();
    if (userId) {
      const user = await currentUser();
      const email = user?.primaryEmailAddress?.emailAddress;
      if (email) {
        const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
        try {
          await runConvexAdminMutation("actions:upsertUserByEmail", {
            email,
            name: fullName || user?.username || undefined,
            handle: user?.username ?? undefined,
            tenantId: tenant.id,
          });
        } catch {}
      }
    }

    return NextResponse.json(tenant, { status: response.status });
  } catch {
    const tenant = simulationTenantFromPayload(payload, host);
    try {
      await persistTenantToConvex(tenant);
    } catch {
      return NextResponse.json({ error: "Failed to create tenant" }, { status: 502 });
    }
    return NextResponse.json(tenant, { status: 201 });
  }
}
