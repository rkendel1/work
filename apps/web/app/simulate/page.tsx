"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Tenant = {
  id: string;
  slug?: string;
  display_name: string;
  domain?: string;
  vertical?: string;
  industry?: string;
};
type InjectionMode = "single" | "burst" | "scenario";
type InjectionResult = {
  content: string;
  ok: boolean;
  endpoint: string;
};

const DEFAULT_SCENARIO_LIBRARY: Record<string, string[]> = {
  "Facilities outage day": [
    "HVAC failure email from Building 2",
    "Water leak escalation from tenant in Suite 401",
    "Generator alert from operations webhook",
  ],
  "Billing system failure": [
    "Invoice mismatch webhook for vendor ACME Utilities",
    "Payment posting delay message from finance bot",
    "Escalation email from accounts payable",
  ],
  "Multi-site vendor disruption": [
    "Vendor no-show escalation for north region",
    "Replacement request for dispatch technician",
    "Service-level breach warning from monitoring",
  ],
  "End-of-month invoice spike": [
    "Batch invoice submission webhook",
    "Duplicate invoice flag from ERP connector",
    "Payment reconciliation queue overflow message",
  ],
};

const VERTICAL_SCENARIO_LIBRARY: Record<
  string,
  { payload: string; scenarios: Record<string, string[]> }
> = {
  healthcare: {
    payload: "Critical lab result routing delay for outpatient clinic",
    scenarios: {
      "Clinic incident surge": [
        "Lab callback queue warning from hematology",
        "Patient intake backlog notification from triage bot",
        "Pharmacy reconciliation mismatch alert",
      ],
      "Care coordination outage": [
        "Referral handoff timeout for cardiology follow-up",
        "Authorization exception from payer integration",
        "Escalation note from nurse station",
      ],
    },
  },
  logistics: {
    payload: "Dispatch exception for regional freight lane",
    scenarios: {
      "Route disruption event": [
        "Carrier late arrival escalation from dock scheduler",
        "Temperature excursion alert for cold-chain shipment",
        "Customs hold update from border broker feed",
      ],
      "Warehouse throughput spike": [
        "Pick-pack queue saturation warning",
        "Loading bay staffing shortage notification",
        "Backorder burst from marketplace integration",
      ],
    },
  },
};

function scenarioProfileForTenant(tenant: Tenant | undefined) {
  const verticalKey = (tenant?.vertical ?? "").toLowerCase().trim();
  return (verticalKey ? VERTICAL_SCENARIO_LIBRARY[verticalKey] : undefined) ?? null;
}

const BURST_VARIATIONS = [
  "critical escalation",
  "sensor anomaly",
  "tenant complaint",
  "vendor delay",
  "ops follow-up",
];

async function postSignal(tenantId: string, content: string) {
  return await fetch("/api/signals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId,
      sourceType: "simulation",
      provenance: {
        origin: "synthetic",
        generatedBy: "scenario_engine",
      },
      normalizedContent: content,
      metadata: {
        channel: "simulator",
        timestamp: Date.now(),
      },
    }),
  });
}

export default function SimulatePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [mode, setMode] = useState<InjectionMode>("single");
  const [payload, setPayload] = useState("HVAC failure email from Building 2");
  const [burstSize, setBurstSize] = useState(10);
  const [scenario, setScenario] = useState("Facilities outage day");
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<InjectionResult[]>([]);

  useEffect(() => {
    fetch("/api/tenants")
      .then(async (response) => {
        if (!response.ok) {
          return [] as Tenant[];
        }
        return (await response.json()) as Tenant[];
      })
      .then((loaded) => {
        setTenants(loaded);
        if (loaded.length > 0) {
          const firstTenant = loaded[0];
          setTenantId(firstTenant.id);
          const profile = scenarioProfileForTenant(firstTenant);
          setPayload(profile?.payload ?? "HVAC failure email from Building 2");
          const firstScenario = Object.keys(profile?.scenarios ?? DEFAULT_SCENARIO_LIBRARY)[0];
          if (firstScenario) {
            setScenario(firstScenario);
          }
        } else {
          setTenantId("");
          setStatus("No simulation tenants found. Add tenants in the database to run live demo scenarios.");
        }
      })
      .catch(() => {
        setTenants([]);
        setStatus("Unable to load tenants from the database.");
      });
  }, []);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId),
    [tenantId, tenants],
  );

  const scenarioLibrary = scenarioProfileForTenant(selectedTenant)?.scenarios ?? DEFAULT_SCENARIO_LIBRARY;

  function handleTenantChange(nextTenantId: string) {
    setTenantId(nextTenantId);
    const nextTenant = tenants.find((tenant) => tenant.id === nextTenantId);
    const profile = scenarioProfileForTenant(nextTenant);
    setPayload(profile?.payload ?? "HVAC failure email from Building 2");
    const firstScenario = Object.keys(profile?.scenarios ?? DEFAULT_SCENARIO_LIBRARY)[0];
    if (firstScenario) {
      setScenario(firstScenario);
    }
  }

  const payloads = useMemo(() => {
    if (mode === "single") {
      return [payload];
    }
    if (mode === "burst") {
      return Array.from(
        { length: burstSize },
        (_, index) => `${payload} • ${BURST_VARIATIONS[index % BURST_VARIATIONS.length]} #${index + 1}`,
      );
    }
    return scenarioLibrary[scenario] ?? [];
  }, [burstSize, mode, payload, scenario, scenarioLibrary]);

  async function runInjection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetDomain = selectedTenant?.domain ?? window.location.host;
    const protocol = targetDomain === "localhost" || targetDomain.endsWith(".localhost") ? "http:" : "https:";
    const targetEndpoint = `${protocol}//${targetDomain}/api/signals`;
    setRunning(true);
    setResults([]);
    setStatus(`Running scenario injection to ${targetEndpoint}...`);
    let successCount = 0;
    for (const content of payloads) {
      const response = await postSignal(tenantId, content);
      if (response.ok) {
        successCount += 1;
      }
      setResults((previous) => [...previous, { content, ok: response.ok, endpoint: targetEndpoint }]);
      if (mode === "burst") {
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 100)));
      }
    }
    setRunning(false);
    setStatus(
      `Scenario injection complete: ${successCount}/${payloads.length} signals processed via ${targetEndpoint}.`,
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-16">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold">Scenario Injection Harness</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Inject operational scenarios into the live stream and run the full ingest-to-execution pipeline.
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Need demo tenant setup?{" "}
          <Link href="/demo-admin" className="underline">
            Open Demo Admin Tool
          </Link>
          .
        </p>
      </section>

      <form onSubmit={runInjection} className="grid gap-4 rounded-lg border bg-white p-5 dark:bg-zinc-800 dark:border-zinc-700">
        <label className="grid gap-1 text-sm">
          Tenant
          <select
            className="rounded border px-3 py-2 dark:bg-zinc-900 dark:border-zinc-600"
            value={tenantId}
            onChange={(event) => handleTenantChange(event.target.value)}
          >
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.display_name}
              </option>
            ))}
            {tenants.length === 0 ? <option value="">No tenants available</option> : null}
          </select>
        </label>

        {selectedTenant ? (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {selectedTenant.vertical ?? "General"} • {selectedTenant.industry ?? "General"} •{" "}
            {selectedTenant.domain ?? "domain unavailable"}
          </p>
        ) : null}

        <label className="grid gap-1 text-sm">
          Mode
          <select
            className="rounded border px-3 py-2 dark:bg-zinc-900 dark:border-zinc-600"
            value={mode}
            onChange={(event) => setMode(event.target.value as InjectionMode)}
          >
            <option value="single">Single Signal</option>
            <option value="burst">Burst Injection</option>
            <option value="scenario">Scenario Injection</option>
          </select>
        </label>

        {mode === "single" || mode === "burst" ? (
          <label className="grid gap-1 text-sm">
            Payload
            <textarea
              className="min-h-24 rounded border px-3 py-2 dark:bg-zinc-900 dark:border-zinc-600"
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
            />
          </label>
        ) : null}

        {mode === "burst" ? (
          <label className="grid gap-1 text-sm">
            Burst size
            <select
              className="rounded border px-3 py-2 dark:bg-zinc-900 dark:border-zinc-600"
              value={burstSize}
              onChange={(event) => setBurstSize(Number(event.target.value))}
            >
              <option value={10}>10</option>
              <option value={100}>100</option>
              <option value={1000}>1000</option>
            </select>
          </label>
        ) : null}

        {mode === "scenario" ? (
          <label className="grid gap-1 text-sm">
            Scenario
            <select
              className="rounded border px-3 py-2 dark:bg-zinc-900 dark:border-zinc-600"
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
            >
              {Object.keys(scenarioLibrary).map((scenarioKey) => (
                <option key={scenarioKey} value={scenarioKey}>
                  {scenarioKey}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="submit"
          disabled={running || !tenantId || payloads.length === 0}
          className="rounded bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {running ? "Running..." : "Run scenario injection"}
        </button>
      </form>

      {status ? <p className="text-sm text-zinc-700 dark:text-zinc-300">{status}</p> : null}
      {tenants.length === 0 ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          No tenants found. Create and seed one in{" "}
          <Link href="/demo-admin" className="underline">
            Demo Admin Tool
          </Link>
          .
        </p>
      ) : null}
      {results.length > 0 ? (
        <section className="rounded-lg border bg-white p-5 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="text-lg font-semibold">Signals sent</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {results.map((result, index) => (
              <li key={`${result.content}-${index}`} className="rounded border p-2 dark:border-zinc-700">
                <p className="font-medium">{result.content}</p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {result.ok ? "Delivered" : "Failed"} • {result.endpoint}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
