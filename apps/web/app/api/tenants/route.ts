import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { runConvexAdminMutation } from "@/lib/convex-admin";
import { normalizeTenantSlug, tenantDomainFromSlug } from "@/lib/tenant-routing";

function requestHost(request: Request): string {
  return (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host
  );
}

function defaultSimulationTenants(host: string) {
  const defaults = [
    {
      slug: "default",
      name: "Default Tenant",
      display_name: "Default Tenant",
      vertical: "Property Management",
      industry: "Commercial Real Estate",
    },
    {
      slug: "northstar-facilities",
      name: "Northstar Facilities",
      display_name: "Northstar Facilities",
      vertical: "Property Management",
      industry: "Commercial Real Estate",
    },
    {
      slug: "harbor-clinic-ops",
      name: "Harbor Clinic Ops",
      display_name: "Harbor Clinic Ops",
      vertical: "Healthcare",
      industry: "Clinic",
    },
  ] as const;

  return defaults.map((tenant) => ({
    id: tenant.slug,
    slug: tenant.slug,
    domain: tenantDomainFromSlug(tenant.slug, host),
    name: tenant.name,
    display_name: tenant.display_name,
    vertical: tenant.vertical,
    industry: tenant.industry,
    created_at: 0,
  }));
}

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
  const fallbackTenants = defaultSimulationTenants(host);
  const allowFallback = simulationFallbackAllowed();
  try {
    const response = await fetch(`${RUST_INGRESS_URL}/tenants`, {
      cache: "no-store",
    });
    if (!response.ok) {
      if (allowFallback) {
        return NextResponse.json(fallbackTenants, { status: 200 });
      }
      return NextResponse.json({ error: "Failed to load tenants" }, { status: response.status });
    }

    const tenants = (await response.json()) as unknown;
    if (!Array.isArray(tenants) || tenants.length === 0) {
      if (allowFallback) {
        return NextResponse.json(fallbackTenants, { status: 200 });
      }
      return NextResponse.json([], { status: 200 });
    }

    return NextResponse.json(tenants, { status: 200 });
  } catch {
    if (allowFallback) {
      return NextResponse.json(fallbackTenants, { status: 200 });
    }
    return NextResponse.json({ error: "Failed to load tenants" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const host = requestHost(request);
  const allowFallback = simulationFallbackAllowed();
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

    if (!response.ok && response.status >= 500 && allowFallback) {
      const tenant = simulationTenantFromPayload(payload, host);
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
    await runConvexAdminMutation("actions:createTenant", {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      domain: tenant.domain,
      displayName: tenant.displayName ?? tenant.display_name ?? tenant.name,
      vertical: tenant.vertical,
      industry: tenant.industry,
      createdAt: tenant.createdAt ?? tenant.created_at ?? Math.floor(Date.now() / 1000),
    });

    const { userId } = await auth();
    if (userId) {
      const user = await currentUser();
      const email = user?.primaryEmailAddress?.emailAddress;
      if (email) {
        const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
        await runConvexAdminMutation("actions:upsertUserByEmail", {
          email,
          name: fullName || user?.username || undefined,
          handle: user?.username ?? undefined,
          tenantId: tenant.id,
        });
      }
    }

    return NextResponse.json(tenant, { status: response.status });
  } catch {
    if (allowFallback) {
      return NextResponse.json(simulationTenantFromPayload(payload, host), { status: 201 });
    }
    return NextResponse.json({ error: "Failed to create tenant" }, { status: 502 });
  }
}
