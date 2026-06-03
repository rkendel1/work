"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Tenant = { id: string; display_name: string };
type SimulationMode = "single" | "burst" | "scenario";

const SCENARIO_LIBRARY: Record<string, string[]> = {
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

async function postSignal(tenantId: string, content: string) {
  return await fetch("/api/signals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId,
      sourceType: "simulation",
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
  const [tenantId, setTenantId] = useState("default");
  const [mode, setMode] = useState<SimulationMode>("single");
  const [payload, setPayload] = useState("HVAC failure email");
  const [burstSize, setBurstSize] = useState(10);
  const [scenario, setScenario] = useState("Facilities outage day");
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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
          setTenantId(loaded[0].id);
        }
      })
      .catch(() => {
        setTenants([]);
      });
  }, []);

  const payloads = useMemo(() => {
    if (mode === "single") {
      return [payload];
    }
    if (mode === "burst") {
      return Array.from({ length: burstSize }, (_, index) => `${payload} #${index + 1}`);
    }
    return SCENARIO_LIBRARY[scenario] ?? [];
  }, [burstSize, mode, payload, scenario]);

  async function runSimulation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setStatus("Running simulation...");
    let successCount = 0;
    for (const content of payloads) {
      const response = await postSignal(tenantId, content);
      if (response.ok) {
        successCount += 1;
      }
      if (mode === "burst") {
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 100)));
      }
    }
    setRunning(false);
    setStatus(`Simulation complete: ${successCount}/${payloads.length} signals processed.`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-16">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold">Simulation Harness</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Generate inbound operational signals and replay the full ingest-to-execution pipeline.
        </p>
      </section>

      <form onSubmit={runSimulation} className="grid gap-4 rounded-lg border bg-white p-5 dark:bg-zinc-800 dark:border-zinc-700">
        <label className="grid gap-1 text-sm">
          Tenant
          <select
            className="rounded border px-3 py-2 dark:bg-zinc-900 dark:border-zinc-600"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
          >
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.display_name}
              </option>
            ))}
            {tenants.length === 0 ? <option value="default">Default Tenant</option> : null}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          Mode
          <select
            className="rounded border px-3 py-2 dark:bg-zinc-900 dark:border-zinc-600"
            value={mode}
            onChange={(event) => setMode(event.target.value as SimulationMode)}
          >
            <option value="single">Single Signal</option>
            <option value="burst">Burst Simulation</option>
            <option value="scenario">Scenario Simulation</option>
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
              {Object.keys(SCENARIO_LIBRARY).map((scenarioKey) => (
                <option key={scenarioKey} value={scenarioKey}>
                  {scenarioKey}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="submit"
          disabled={running}
          className="rounded bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {running ? "Running..." : "Run simulation"}
        </button>
      </form>

      {status ? <p className="text-sm text-zinc-700 dark:text-zinc-300">{status}</p> : null}
    </main>
  );
}
