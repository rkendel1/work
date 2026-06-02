import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

export async function GET() {
  const response = await fetch(`${RUST_INGRESS_URL}/items`, {
    cache: "no-store",
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
