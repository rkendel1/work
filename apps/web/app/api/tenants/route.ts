import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

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
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Tenant service unavailable" }, { status: 503 });
  }
}
