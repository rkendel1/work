import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { resolveTenantId } from "@/lib/tenant-context";

export async function GET(request: Request) {
  const tenantId = resolveTenantId(request);
  const query = new URLSearchParams();
  if (tenantId) {
    query.set("tenantId", tenantId);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetch(`${RUST_INGRESS_URL}/vault/keys${suffix}`, {
    cache: "no-store",
  });
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  const payload = await request.text();
  const response = await fetch(`${RUST_INGRESS_URL}/vault/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request);
  if (tenantId && !url.searchParams.has("tenantId")) {
    url.searchParams.set("tenantId", tenantId);
  }
  const response = await fetch(`${RUST_INGRESS_URL}/vault/keys?${url.searchParams.toString()}`, {
    method: "DELETE",
  });
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
