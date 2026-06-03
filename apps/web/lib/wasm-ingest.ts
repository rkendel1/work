import { ConvexHttpClient } from "convex/browser";
import { loadWasm } from "@/lib/wasm-runtime";

type SignalMetadata = {
  sender?: string;
  timestamp?: number;
  channel?: string;
};

type SignalProvenance = {
  origin: "real" | "synthetic" | "mixed";
  generatedBy: "user" | "system" | "scenario_engine";
};

type IngestInput = {
  tenantId: string;
  sourceType: string;
  provenance?: SignalProvenance;
  rawPayload: unknown;
  normalizedContent?: string;
  metadata?: SignalMetadata;
};

type WasmResult = {
  classification?: string;
  confidence?: number;
  priority?: string;
  reason?: string;
  entities?: string[];
  summary?: string;
  title?: string;
  recommended_actions?: Array<{
    title?: string;
    description?: string;
    actionType?: string;
  }>;
};

function normalizeSignalContent(rawPayload: unknown, normalizedContent?: string) {
  const trimmed = normalizedContent?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (typeof rawPayload === "string") {
    return rawPayload.trim();
  }

  if (rawPayload && typeof rawPayload === "object") {
    const payload = rawPayload as Record<string, unknown>;
    const values = [payload.content, payload.text, payload.body]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (values.length > 0) {
      return values[0];
    }
  }

  return "";
}

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  }
  return new ConvexHttpClient(url);
}

function defaultProvenance(sourceType: string): SignalProvenance {
  if (sourceType === "simulation") {
    return { origin: "synthetic", generatedBy: "scenario_engine" };
  }
  if (sourceType === "replay") {
    return { origin: "mixed", generatedBy: "system" };
  }
  if (sourceType === "email" || sourceType === "webhook" || sourceType === "api") {
    return { origin: "real", generatedBy: "user" };
  }
  return { origin: "real", generatedBy: "system" };
}

export async function ingestSignalWithWasm(input: IngestInput) {
  const normalizedContent = normalizeSignalContent(input.rawPayload, input.normalizedContent);
  if (!normalizedContent) {
    throw new Error("normalizedContent or rawPayload with text is required");
  }

  const metadataTimestamp = input.metadata?.timestamp ?? Date.now();
  const metadata = {
    sender: input.metadata?.sender,
    timestamp: metadataTimestamp,
    channel: input.metadata?.channel,
  };
  const provenance = input.provenance ?? defaultProvenance(input.sourceType);

  const wasm = await loadWasm();
  const result = JSON.parse(
    wasm.process(
      JSON.stringify({
        sourceType: input.sourceType,
        normalizedContent,
        rawPayload: input.rawPayload,
        metadata,
      }),
    ),
  ) as WasmResult;

  const classification = result.classification ?? "general_inquiry";
  const summary = (result.summary ?? normalizedContent).slice(0, 240);
  const title = result.title ?? `${classification.replace(/_/g, " ")} signal`;
  const now = Date.now();
  const inboxExternalId = crypto.randomUUID();
  const workExternalId = crypto.randomUUID();
  const client = convexClient();
  const mutation = client.mutation.bind(client) as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;

  await mutation("inbox:createSignalEvent", {
    tenantId: input.tenantId,
    sourceType: input.sourceType,
    provenance,
    rawPayload: input.rawPayload,
    normalizedContent,
    metadata,
  });

  await mutation("inbox:ingestInboxItem", {
    tenantId: input.tenantId,
    externalId: inboxExternalId,
    source: input.sourceType,
    receivedAt: new Date(metadataTimestamp).toISOString(),
    content: normalizedContent,
    status: "received",
    statusUpdatedAt: now,
  });

  await mutation("inbox:createIngressEvent", {
    tenantId: input.tenantId,
    ingressExternalId: inboxExternalId,
    eventType: "received",
    description: "Signal ingested via wasm runtime",
    createdAt: now,
  });

  await mutation("inbox:createWorkItem", {
    tenantId: input.tenantId,
    externalId: workExternalId,
    inboxExternalId,
    classificationType: classification,
    title,
    summary,
    status: "open",
    recommendedActions: (result.recommended_actions ?? []).map((action) => ({
      title: action.title ?? "Review signal",
      description: action.description ?? "Review and route signal.",
      actionType: action.actionType ?? "review",
    })),
    operationalMeaning: {
      systemConcept: classification,
      inferredMeaning: result.reason ?? summary,
      state: "inferred",
      confidence: result.confidence ?? 0.72,
      evidence: [
        `priority:${result.priority ?? "low"}`,
        ...(result.entities ?? []).map((entity) => `entity:${entity}`),
      ],
      updatedAt: now,
    },
  });

  await mutation("inbox:updateIngressStatus", {
    tenantId: input.tenantId,
    ingressExternalId: inboxExternalId,
    status: "work_generated",
    statusUpdatedAt: now,
    eventType: "work_generated",
    description: `Work generated: ${classification}`,
    createdAt: now,
  });

  return {
    inboxItem: {
      id: inboxExternalId,
      source: input.sourceType,
      content: normalizedContent,
      status: "work_generated",
      statusUpdatedAt: now,
    },
    workItem: {
      id: workExternalId,
      classificationType: classification,
      title,
      summary,
      priority: result.priority ?? "low",
      confidence: result.confidence ?? 0.72,
      entities: result.entities ?? [],
    },
  };
}
