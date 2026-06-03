import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { resolveTenantId } from "@/lib/tenant-context";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tenantId = resolveTenantId(request);
  const type = requestUrl.searchParams.get("type");
  const q = requestUrl.searchParams.get("q");
  const query = new URLSearchParams();
  if (tenantId) {
    query.set("tenantId", tenantId);
  }
  if (type) {
    query.set("type", type);
  }
  if (q) {
    query.set("q", q);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";

  try {
    const response = await fetch(`${RUST_INGRESS_URL}/operational-artifacts${suffix}`, {
      cache: "no-store",
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
