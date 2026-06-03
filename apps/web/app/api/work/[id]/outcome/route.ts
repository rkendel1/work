import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const payload = await request.text();
  const { id } = await context.params;
  const response = await fetch(`${RUST_INGRESS_URL}/work/${encodeURIComponent(id)}/outcome`, {
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
