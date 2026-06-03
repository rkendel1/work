import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const response = await fetch(`${RUST_INGRESS_URL}/executions?${url.searchParams.toString()}`, {
    cache: "no-store",
  });
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
