import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

export async function POST(request: Request) {
  const webhookSecret = process.env.POSTMARK_WEBHOOK_SECRET;

  if (webhookSecret) {
    const receivedSecret = request.headers.get("x-postmark-secret");
    if (receivedSecret !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const upstream = await fetch(`${RUST_INGRESS_URL}/webhooks/postmark`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await upstream.text();

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: "Rust ingress webhook processing failed",
        upstreamStatus: upstream.status,
        upstreamBody: responseBody,
      },
      { status: upstream.status },
    );
  }

  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
