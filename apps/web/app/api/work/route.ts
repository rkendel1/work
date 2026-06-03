import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

export async function GET(request: Request) {
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const response = await fetch(`${RUST_INGRESS_URL}/work${query}`, {
    cache: "no-store",
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
