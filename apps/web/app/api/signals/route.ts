import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

type SignalPayload = {
  sourceType?: string;
  rawPayload?: unknown;
  normalizedContent?: string;
  metadata?: {
    sender?: string;
    timestamp?: number;
    channel?: string;
  };
  tenantId?: string;
};

export async function POST(request: Request) {
  let payload: SignalPayload;

  try {
    payload = (await request.json()) as SignalPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const sourceType = payload.sourceType?.trim() || "api";
  const tenantId = payload.tenantId?.trim();
  const normalizedContent = payload.normalizedContent?.trim();

  if (!normalizedContent && !payload.rawPayload) {
    return NextResponse.json(
      { error: "normalizedContent or rawPayload is required" },
      { status: 400 },
    );
  }

  const ingestResponse = await fetch(`${RUST_INGRESS_URL}/signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceType,
      rawPayload: payload.rawPayload,
      normalizedContent,
      metadata: payload.metadata,
      tenantId,
    }),
  });

  if (!ingestResponse.ok) {
    const body = await ingestResponse.text();
    return NextResponse.json(
      { error: "Signal ingest failed", upstreamBody: body },
      { status: ingestResponse.status },
    );
  }

  const inboxItem = (await ingestResponse.json()) as { id: string };

  const extractResponse = await fetch(`${RUST_INGRESS_URL}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inbox_item_id: inboxItem.id }),
  });

  if (!extractResponse.ok) {
    const body = await extractResponse.text();
    return NextResponse.json(
      { error: "Signal extraction failed", inboxItem, upstreamBody: body },
      { status: extractResponse.status },
    );
  }

  const workItem = await extractResponse.json();
  return NextResponse.json({ inboxItem, workItem }, { status: 201 });
}
