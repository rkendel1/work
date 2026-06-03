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
  tenant_id: string;
  source: string;
  received_at: string;
  content: string;
  status: string;
  status_updated_at: string;
};

export type WorkItem = {
  id: string;
  tenant_id: string;
  inbox_item_id: string;
  classification_type: string;
  title: string;
  summary: string;
  status: string;
  recommended_actions?: IngressRecommendedAction[];
};

type Tenant = {
  id: string;
  display_name: string;
  vertical: string;
  industry: string;
};

type ActionDefinition = {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  category: string;
  classification_types: string[];
  active: boolean;
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

type Tab = "inbox" | "work" | "actions" | "settings";

export function InboxClient({
  initialInboxItems,
  initialWorkItems,
}: InboxClientProps) {
  const [tab, setTab] = useState<Tab>("inbox");
  const [tenantId, setTenantId] = useState("default");
  const [source, setSource] = useState("manual");
  const [content, setContent] = useState("");
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(initialInboxItems);
  const [workItems, setWorkItems] = useState<WorkItem[]>(initialWorkItems);
  const [tenants, setTenants] = useState<Tenant[]>([
    {
      id: "default",
      display_name: "Default Tenant",
      vertical: "Property Management",
      industry: "Commercial Real Estate",
    },
  ]);
  const [actions, setActions] = useState<ActionDefinition[]>([]);
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(
    initialInboxItems[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeline, setTimeline] = useState<IngressTimelineEventModel[]>([]);
  const [newActionName, setNewActionName] = useState("");
  const [newActionDescription, setNewActionDescription] = useState("");
  const [newActionCategory, setNewActionCategory] = useState("maintenance");
  const [newActionClassification, setNewActionClassification] = useState(
    "maintenance_request",
  );
  const [tenantName, setTenantName] = useState("");
  const [tenantVertical, setTenantVertical] = useState("Property Management");
  const [tenantIndustry, setTenantIndustry] = useState("Commercial Real Estate");

  const refresh = useCallback(async () => {
    const tenantQuery = `tenantId=${encodeURIComponent(tenantId)}`;
    const [items, work, tenantList, actionList] = await Promise.all([
      fetchJson<InboxItem[]>(`/api/items?${tenantQuery}`),
      fetchJson<WorkItem[]>(`/api/work?${tenantQuery}`),
      fetchJson<Tenant[]>("/api/tenants"),
      fetchJson<ActionDefinition[]>(`/api/actions?${tenantQuery}`),
    ]);
    setInboxItems(items);
    setWorkItems(work);
    setTenants(tenantList);
    setActions(actionList);
    setSelectedInboxId((current) => {
      if (current && items.some((item) => item.id === current)) {
        return current;
      }
      return items[0]?.id ?? null;
    });
  }, [tenantId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

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
        body: JSON.stringify({ source, content, tenantId }),
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

  async function onCreateAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        name: newActionName,
        description: newActionDescription,
        category: newActionCategory,
        classificationTypes: [newActionClassification],
        active: true,
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setNewActionName("");
    setNewActionDescription("");
    await refresh();
  }

  async function onCreateTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: tenantName,
        vertical: tenantVertical,
        industry: tenantIndustry,
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    const tenant = (await response.json()) as Tenant;
    setTenantName("");
    setTenantId(tenant.id);
  }

  const selectedInbox = inboxItems.find((item) => item.id === selectedInboxId) ?? null;
  const selectedWork = workItems.find((work) => work.inbox_item_id === selectedInboxId) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">Operations Inbox</h1>
        <div className="flex flex-wrap items-center gap-2">
          {(["inbox", "work", "actions", "settings"] as Tab[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`rounded border px-3 py-1 text-sm capitalize ${
                tab === name ? "bg-zinc-900 text-white" : "bg-white"
              }`}
            >
              {name}
            </button>
          ))}
          <select
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            className="ml-auto rounded border px-2 py-1 text-sm"
          >
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.display_name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {tab === "inbox" ? (
        <>
          <form onSubmit={onSubmit} className="space-y-3 rounded-lg border p-4">
            <label className="block text-sm font-medium" htmlFor="source">
              Source
            </label>
            <input
              id="source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="w-full rounded border px-3 py-2"
            />
            <label className="block text-sm font-medium" htmlFor="content">
              Paste something operational
            </label>
            <textarea
              id="content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={4}
              className="w-full rounded border px-3 py-2"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-black px-4 py-2 text-white disabled:opacity-60"
            >
              {loading ? "Submitting..." : "Submit"}
            </button>
          </form>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="rounded-lg border p-4">
              <h2 className="mb-3 text-lg font-semibold">Inbox</h2>
              <div className="space-y-2">
                {inboxItems.map((item) => (
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
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border p-4">
              <h2 className="mb-3 text-lg font-semibold">Detail</h2>
              {selectedInbox ? (
                <div className="space-y-3 text-sm">
                  <p className="whitespace-pre-wrap text-zinc-700">{selectedInbox.content}</p>
                  {selectedWork ? (
                    <>
                      <div className="rounded border p-3">
                        <p className="font-medium">{selectedWork.title}</p>
                        <p className="text-zinc-700">{selectedWork.summary}</p>
                      </div>
                      <IngressRecommendationsCard
                        recommendations={selectedWork.recommended_actions ?? []}
                      />
                    </>
                  ) : null}
                  <IngressTimeline events={timeline} />
                </div>
              ) : (
                <p className="text-sm text-zinc-600">Select an inbox item.</p>
              )}
            </section>
          </div>
        </>
      ) : null}

      {tab === "work" ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-lg font-semibold">Work</h2>
          <div className="space-y-2">
            {workItems.map((work) => (
              <div key={work.id} className="rounded border p-3 text-sm">
                <p className="font-medium">{work.title}</p>
                <p className="text-zinc-700">{work.summary}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Classification: {work.classification_type}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "actions" ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-lg font-semibold">Action Studio</h2>
          <form onSubmit={onCreateAction} className="mb-4 grid gap-2 md:grid-cols-2">
            <input
              value={newActionName}
              onChange={(event) => setNewActionName(event.target.value)}
              className="rounded border px-3 py-2"
              placeholder="Action Name"
              required
            />
            <input
              value={newActionCategory}
              onChange={(event) => setNewActionCategory(event.target.value)}
              className="rounded border px-3 py-2"
              placeholder="Category"
              required
            />
            <input
              value={newActionClassification}
              onChange={(event) => setNewActionClassification(event.target.value)}
              className="rounded border px-3 py-2"
              placeholder="Classification Type"
              required
            />
            <input
              value={newActionDescription}
              onChange={(event) => setNewActionDescription(event.target.value)}
              className="rounded border px-3 py-2"
              placeholder="Description"
              required
            />
            <button type="submit" className="rounded bg-black px-4 py-2 text-white">
              Add Action
            </button>
          </form>
          <div className="space-y-2">
            {actions.map((action) => (
              <div key={action.id} className="rounded border p-3 text-sm">
                <p className="font-medium">{action.name}</p>
                <p className="text-zinc-700">{action.description}</p>
                <p className="text-xs text-zinc-500">
                  {action.category} • {action.classification_types.join(", ")}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-lg font-semibold">Tenant Setup</h2>
          <form onSubmit={onCreateTenant} className="grid gap-2 md:grid-cols-2">
            <input
              value={tenantName}
              onChange={(event) => setTenantName(event.target.value)}
              className="rounded border px-3 py-2"
              placeholder="Organization Name"
              required
            />
            <input
              value={tenantVertical}
              onChange={(event) => setTenantVertical(event.target.value)}
              className="rounded border px-3 py-2"
              placeholder="Vertical"
              required
            />
            <input
              value={tenantIndustry}
              onChange={(event) => setTenantIndustry(event.target.value)}
              className="rounded border px-3 py-2"
              placeholder="Industry"
              required
            />
            <button type="submit" className="rounded bg-black px-4 py-2 text-white">
              Create Tenant
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
