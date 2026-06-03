import { NextResponse } from "next/server";
import { resolveTenantId } from "@/lib/tenant-context";
import { ingestSignalWithWasm } from "@/lib/wasm-ingest";

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
  const tenantId = payload.tenantId?.trim() || resolveTenantId(request) || "default";

  if (!source || !content) {
    return NextResponse.json(
      { error: "source and content are required" },
      { status: 400 },
    );
  }

  try {
    const result = await ingestSignalWithWasm({
      tenantId,
      sourceType: source,
      rawPayload: { source, content },
      normalizedContent: content,
      metadata: {
        timestamp: Date.now(),
        channel: "api",
      },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "WASM ingest failed", detail: error instanceof Error ? error.message : "unknown" },
      { status: 500 },
    );
  }
}
