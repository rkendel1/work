import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { resolveTenantId } from "@/lib/tenant-context";

export async function GET(request: Request) {
  const tenantId = resolveTenantId(request);
  const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const response = await fetch(`${RUST_INGRESS_URL}/behavioral-patterns${query}`, {
    cache: "no-store",
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
