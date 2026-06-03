import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
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
  try {
    const response = await fetch(`${RUST_INGRESS_URL}/tenants`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json(fallbackTenants, { status: 200 });
    }

    const tenants = (await response.json()) as unknown;
    if (!Array.isArray(tenants) || tenants.length === 0) {
      return NextResponse.json(fallbackTenants, { status: 200 });
    }

    return NextResponse.json(tenants, { status: 200 });
  } catch {
    return NextResponse.json(fallbackTenants, { status: 200 });
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
      return NextResponse.json(simulationTenantFromPayload(payload, host), { status: 201 });
    }

    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json(simulationTenantFromPayload(payload, host), { status: 201 });
  }
}
