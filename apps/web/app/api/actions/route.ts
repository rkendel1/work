import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { resolveTenantId } from "@/lib/tenant-context";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request);
  const classificationType = url.searchParams.get("classificationType");
  const query = new URLSearchParams();
  if (tenantId) {
    query.set("tenantId", tenantId);
  }
  if (classificationType) {
    query.set("classificationType", classificationType);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetch(`${RUST_INGRESS_URL}/actions${suffix}`, {
    cache: "no-store",
  });
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const response = await fetch(`${RUST_INGRESS_URL}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
