import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { normalizeTenantSlug, tenantDomainFromSlug } from "@/lib/tenant-routing";

const DEFAULT_SIMULATION_TENANTS = [
  {
    id: "default",
    slug: "default",
    domain: "www.canonflo.com",
    name: "Default Tenant",
    display_name: "Default Tenant",
    vertical: "Property Management",
    industry: "Commercial Real Estate",
    created_at: 0,
  },
  {
    id: "northstar_facilities",
    slug: "northstar-facilities",
    domain: "northstar-facilities.canonflo.com",
    name: "Northstar Facilities",
    display_name: "Northstar Facilities",
    vertical: "Property Management",
    industry: "Commercial Real Estate",
    created_at: 0,
  },
  {
    id: "harbor_clinic_ops",
    slug: "harbor-clinic-ops",
    domain: "harbor-clinic-ops.canonflo.com",
    name: "Harbor Clinic Ops",
    display_name: "Harbor Clinic Ops",
    vertical: "Healthcare",
    industry: "Clinic",
    created_at: 0,
  },
] as const;

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

function simulationTenantFromPayload(payload: unknown) {
  const candidate = (payload ?? {}) as CreateTenantPayload;
  const name = asTrimmedString(candidate.name) ?? "New Tenant";
  const rawSlug = asTrimmedString(candidate.slug) ?? asTrimmedString(candidate.subdomain) ?? name;
  const slug = normalizeTenantSlug(rawSlug) || "default";
  const vertical = asTrimmedString(candidate.vertical) ?? "Property Management";
  const industry = asTrimmedString(candidate.industry) ?? "Commercial Real Estate";

  return {
    id: slug,
    slug,
    domain: tenantDomainFromSlug(slug),
    name,
    display_name: name,
    vertical,
    industry,
    created_at: Math.floor(Date.now() / 1000),
  };
}

export async function GET() {
  try {
    const response = await fetch(`${RUST_INGRESS_URL}/tenants`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json(DEFAULT_SIMULATION_TENANTS, { status: 200 });
    }

    const tenants = (await response.json()) as unknown;
    if (!Array.isArray(tenants) || tenants.length === 0) {
      return NextResponse.json(DEFAULT_SIMULATION_TENANTS, { status: 200 });
    }

    return NextResponse.json(tenants, { status: 200 });
  } catch {
    return NextResponse.json(DEFAULT_SIMULATION_TENANTS, { status: 200 });
  }
}

export async function POST(request: Request) {
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
      return NextResponse.json(simulationTenantFromPayload(payload), { status: 201 });
    }

    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json(simulationTenantFromPayload(payload), { status: 201 });
  }
}
