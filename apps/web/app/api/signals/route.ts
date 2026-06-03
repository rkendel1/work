import { NextResponse } from "next/server";
import { resolveTenantId } from "@/lib/tenant-context";
import { ingestSignalWithWasm } from "@/lib/wasm-ingest";

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
  const tenantId = payload.tenantId?.trim() || resolveTenantId(request) || "default";
  const normalizedContent = payload.normalizedContent?.trim();

  if (!normalizedContent && !payload.rawPayload) {
    return NextResponse.json(
      { error: "normalizedContent or rawPayload is required" },
      { status: 400 },
    );
  }

  try {
    const result = await ingestSignalWithWasm({
      tenantId,
      sourceType,
      rawPayload: payload.rawPayload ?? {},
      normalizedContent,
      metadata: payload.metadata,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "WASM signal ingest failed", detail: error instanceof Error ? error.message : "unknown" },
      { status: 500 },
    );
  }
}
