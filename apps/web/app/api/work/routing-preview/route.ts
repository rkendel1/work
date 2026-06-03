import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { resolveTenantId } from "@/lib/tenant-context";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = resolveTenantId(request);
  const classificationType = url.searchParams.get("classificationType");
  const actionName = url.searchParams.get("actionName");
  const signalContent = url.searchParams.get("signalContent");

  const query = new URLSearchParams();
  if (tenantId) {
    query.set("tenantId", tenantId);
  }
  if (classificationType) {
    query.set("classificationType", classificationType);
  }
  if (actionName) {
    query.set("actionName", actionName);
  }
  if (signalContent) {
    query.set("signalContent", signalContent);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetch(`${RUST_INGRESS_URL}/work/routing-preview${suffix}`, {
    cache: "no-store",
  });
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
