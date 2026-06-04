import { NextResponse } from "next/server";
import { resolveTenantId } from "@/lib/tenant-context";
import { isRootHost, normalizeTenantSlug, tenantDomainFromSlug } from "@/lib/tenant-routing";
import { ingestSignalWithWasm } from "@/lib/wasm-ingest";

type SignalPayload = {
  sourceType?: string;
  provenance?: {
    origin?: "real" | "synthetic" | "mixed";
    generatedBy?: "user" | "system" | "scenario_engine";
  };
  rawPayload?: unknown;
  normalizedContent?: string;
  metadata?: {
    sender?: string;
    timestamp?: number;
    channel?: string;
  };
  tenantId?: string;
};

function normalizeHost(value: string): string {
  return value.toLowerCase().trim().split(":")[0];
}

function forwardingTenant(tenantId: string | undefined): string | null {
  if (!tenantId) {
    return null;
  }
  return normalizeTenantSlug(tenantId) || null;
}

export async function POST(request: Request) {
  let payload: SignalPayload;

  try {
    payload = (await request.json()) as SignalPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const sourceType = payload.sourceType?.trim() || "api";
  const requestHost = normalizeHost(new URL(request.url).host);
  const requestedTenantId = payload.tenantId?.trim() || undefined;
  const targetTenant = forwardingTenant(requestedTenantId);
  const targetDomain = targetTenant && isRootHost(requestHost) ? normalizeHost(tenantDomainFromSlug(targetTenant, requestHost)) : null;

  if (targetDomain && targetDomain !== requestHost) {
    const protocol =
      requestHost === "localhost" ||
      requestHost.endsWith(".localhost") ||
      targetDomain === "localhost" ||
      targetDomain.endsWith(".localhost")
        ? "http"
        : "https";
    try {
      const forwardResponse = await fetch(`${protocol}://${targetDomain}/api/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await forwardResponse.text();
      return new NextResponse(body, {
        status: forwardResponse.status,
        headers: {
          "Content-Type": forwardResponse.headers.get("Content-Type") ?? "application/json",
        },
      });
    } catch {
      return NextResponse.json({ error: "Failed to forward signal to tenant domain" }, { status: 502 });
    }
  }

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
      provenance:
        payload.provenance?.origin && payload.provenance.generatedBy
          ? {
              origin: payload.provenance.origin,
              generatedBy: payload.provenance.generatedBy,
            }
          : undefined,
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
