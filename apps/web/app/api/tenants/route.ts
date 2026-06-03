import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

export async function GET() {
  try {
    const response = await fetch(`${RUST_INGRESS_URL}/tenants`, {
      cache: "no-store",
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json([{ id: "default", display_name: "Default Tenant" }], { status: 200 });
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
