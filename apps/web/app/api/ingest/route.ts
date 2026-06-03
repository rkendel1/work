import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

type IngestPayload = {
  source?: string;
  content?: string;
  tenantId?: string;
};

export async function POST(request: Request) {
  let payload: IngestPayload;

  try {
    payload = (await request.json()) as IngestPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const source = payload.source?.trim();
  const content = payload.content?.trim();
  const tenantId = payload.tenantId?.trim();

  if (!source || !content) {
    return NextResponse.json(
      { error: "source and content are required" },
      { status: 400 },
    );
  }

  const ingestResponse = await fetch(`${RUST_INGRESS_URL}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, content, tenantId }),
  });

  if (!ingestResponse.ok) {
    const body = await ingestResponse.text();
    return NextResponse.json(
      { error: "Ingress ingest failed", upstreamBody: body },
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
      { error: "Ingress extraction failed", inboxItem, upstreamBody: body },
      { status: extractResponse.status },
    );
  }

  const workItem = await extractResponse.json();

  return NextResponse.json({ inboxItem, workItem }, { status: 201 });
}
