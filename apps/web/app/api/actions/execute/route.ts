import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

export async function POST(request: Request) {
  const payload = await request.text();
  const response = await fetch(`${RUST_INGRESS_URL}/actions/execute`, {
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
