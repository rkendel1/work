"use client";

import { IngressStatusBadge } from "@/components/ingress/IngressStatusBadge";
import {
  IngressRecommendationsCard,
  type IngressRecommendedAction,
} from "@/components/ingress/IngressRecommendationsCard";
import {
  IngressTimeline,
  type IngressTimelineEventModel,
} from "@/components/ingress/IngressTimeline";
import { FormEvent, useCallback, useEffect, useState } from "react";

export type InboxItem = {
  id: string;
  source: string;
  received_at: string;
  content: string;
  status: string;
  status_updated_at: string;
};

export type WorkItem = {
  id: string;
  inbox_item_id: string;
  title: string;
  summary: string;
  status: string;
  recommended_actions?: IngressRecommendedAction[];
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

type InboxClientProps = {
  initialInboxItems: InboxItem[];
  initialWorkItems: WorkItem[];
};

export function InboxClient({
  initialInboxItems,
  initialWorkItems,
}: InboxClientProps) {
  const [source, setSource] = useState("manual");
  const [content, setContent] = useState("");
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(initialInboxItems);
  const [workItems, setWorkItems] = useState<WorkItem[]>(initialWorkItems);
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(
    initialInboxItems[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeline, setTimeline] = useState<IngressTimelineEventModel[]>([]);

  const refresh = useCallback(async () => {
    const [items, work] = await Promise.all([
      fetchJson<InboxItem[]>("/api/items"),
      fetchJson<WorkItem[]>("/api/work"),
    ]);
    setInboxItems(items);
    setWorkItems(work);

    if (!selectedInboxId && items.length > 0) {
      setSelectedInboxId(items[0].id);
    }
  }, [selectedInboxId]);

  useEffect(() => {
    if (!selectedInboxId) {
      return;
    }

    const loadTimeline = async () => {
      try {
        const events = await fetchJson<IngressTimelineEventModel[]>(
          `/api/items/${selectedInboxId}/timeline`,
        );
        setTimeline(events);
      } catch {
        setTimeline([]);
      }
    };

    void loadTimeline();
  }, [selectedInboxId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) {
      setError("Please paste some operational information first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, content }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ingest failed: ${body}`);
      }

      setContent("");
      await refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed submitting item",
      );
    } finally {
      setLoading(false);
    }
  }

  const selectedInbox = inboxItems.find((item) => item.id === selectedInboxId) ?? null;
  const selectedWork = workItems.find((work) => work.inbox_item_id === selectedInboxId) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Operations Inbox</h1>
        <p className="text-sm text-zinc-600">
          Ingress-first queue powered by Next.js, Better Auth, Rust, and Convex.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-3 rounded-lg border p-4">
        <label className="block text-sm font-medium" htmlFor="source">
          Source
        </label>
        <input
          id="source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="w-full rounded border px-3 py-2"
          placeholder="manual | email | slack"
        />

        <label className="block text-sm font-medium" htmlFor="content">
          Paste something operational
        </label>
        <textarea
          id="content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={5}
          className="w-full rounded border px-3 py-2"
          placeholder="Customer emailed: The HVAC unit on floor 3 is making noise..."
        />

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-60"
        >
          {loading ? "Submitting..." : "Submit"}
        </button>
      </form>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-lg font-semibold">Inbox</h2>
          <div className="space-y-2">
            {inboxItems.map((item) => {
              const workItem = workItems.find((work) => work.inbox_item_id === item.id);
              const recommendationCount = workItem?.recommended_actions?.length ?? 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedInboxId(item.id)}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${
                    selectedInboxId === item.id ? "bg-zinc-100" : "bg-white"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="font-medium">{item.source}</p>
                    <IngressStatusBadge status={item.status} />
                  </div>
                  <p className="line-clamp-2 text-zinc-600">{item.content}</p>
                  {recommendationCount > 0 ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      {recommendationCount} Recommended Actions
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-lg font-semibold">Detail</h2>
          {selectedInbox ? (
            <div className="space-y-3 text-sm">
              <div>
                <h3 className="font-medium">Raw Message</h3>
                <p className="whitespace-pre-wrap text-zinc-700">{selectedInbox.content}</p>
                <div className="mt-2">
                  <IngressStatusBadge status={selectedInbox.status} />
                </div>
              </div>
              <div>
                <h3 className="font-medium">Extracted Work</h3>
                {selectedWork ? (
                  <div className="rounded border p-3">
                    <p className="font-medium">{selectedWork.title}</p>
                    <p className="text-zinc-700">{selectedWork.summary}</p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
                      Status: {selectedWork.status}
                    </p>
                  </div>
                ) : (
                  <p className="text-zinc-600">No extracted work yet.</p>
                )}
              </div>
              {selectedWork ? (
                <IngressRecommendationsCard
                  recommendations={selectedWork.recommended_actions ?? []}
                />
              ) : null}
              <div>
                <h3 className="font-medium">Processing Timeline</h3>
                <div className="mt-2">
                  <IngressTimeline events={timeline} />
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-600">Select an inbox item to inspect it.</p>
          )}
        </section>
      </div>
    </div>
  );
}
