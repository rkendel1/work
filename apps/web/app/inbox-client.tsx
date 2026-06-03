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
  assigned_org_unit_id: string;
  current_owner_id?: string;
  routing_path: string[];
  priority?: string;
  escalation_target?: string;
  suppress_action?: boolean;
  require_approval?: boolean;
  applied_rules?: Array<{
    rule_id: string;
    title: string;
    scope: string;
    effect_summary: string;
  }>;
  recommended_actions?: IngressRecommendedAction[];
  operational_meaning?: {
    tenant_id: string;
    entity_type: string;
    entity_id: string;
    system_concept: string;
    inferred_meaning: string;
    state: string;
    confidence: number;
    evidence: string[];
    crosswalk_version?: string;
    updated_at: number;
  };
};

type Tenant = {
  id: string;
  slug?: string;
  domain?: string;
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
  assigned_org_unit_id: string;
  default_owner_role?: string;
  active: boolean;
  execution_provider?: string;
};

type OrgUnit = {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  parent_id?: string;
};

type WorkRoutingPreview = {
  classification_type: string;
  action_name?: string | null;
  assigned_org_unit?: OrgUnit | null;
  routing_path: OrgUnit[];
  priority?: string;
  escalation_target?: string;
  suppress_action?: boolean;
  require_approval?: boolean;
  applied_rules?: Array<{
    rule_id: string;
    title: string;
    scope: string;
    effect_summary: string;
  }>;
};

type BusinessRule = {
  id: string;
  tenant_id: string;
  org_unit_id?: string;
  title: string;
  rule_text: string;
  scope: string;
  active: boolean;
  priority: number;
};

type VaultKey = {
  id: string;
  tenant_id: string;
  key_name: string;
  provider: string;
  created_at: number;
};

type ActionExecution = {
  id: string;
  tenant_id: string;
  work_item_id: string;
  action_id: string;
  executed_by: string;
  execution_type: string;
  status: string;
  result_type: string;
  summary: string;
  side_effects: Array<{
    type: string;
    target_system?: string;
    target_id?: string;
    description: string;
  }>;
  context_snapshot: unknown;
  timestamp: number;
  provider: string;
  external_ref?: string;
  payload: unknown;
  message?: string;
  executed_at?: string;
};

type BehavioralPattern = {
  id: string;
  tenant_id: string;
  pattern_type: string;
  description: string;
  evidence: unknown;
  confidence: number;
  impact_score: number;
  first_observed_at: number;
  last_observed_at: number;
};

type ProcessNode = {
  id: string;
  tenant_id: string;
  org_unit_id?: string;
  name: string;
  type: string;
  source: string;
  confidence: number;
  first_seen_at: number;
  last_seen_at: number;
};

type ProcessEdge = {
  id: string;
  tenant_id: string;
  from_node_id: string;
  to_node_id: string;
  transition_type: string;
  frequency: number;
  confidence: number;
};

type ProcessGraph = {
  tenant_id: string;
  process_name: string;
  process_nodes: ProcessNode[];
  process_edges: ProcessEdge[];
  designed_process: string[];
  drift_score: number;
  bottlenecks: string[];
  bypass_paths: string[];
  external_execution_points: string[];
};

type OperationalArtifact = {
  tenant_id: string;
  name: string;
  type: "process_map" | "SOP" | "policy" | "swimlane" | "decision_tree" | string;
  org_unit_id?: string;
  source: string;
  version: number;
  content: unknown;
  derived_from: string[];
  last_updated_at: number;
};

type OperationalKnowledgeTab = "processes" | "sops" | "policies" | "exceptions" | "drift";
type ContextViewMode = "raw" | "operational";

function contextFallback() {
  return {
    inferredMeaning: "Unknown",
    state: "inferred",
    confidence: 0,
    evidence: [],
  };
}

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

type Tab =
  | "inbox"
  | "work"
  | "actions"
  | "organization"
  | "rules"
  | "truth"
  | "settings";

type SetupPack = {
  vertical: string;
  industries: string[];
  classifications: string[];
};

const SETUP_PACKS: SetupPack[] = [
  {
    vertical: "Property Management",
    industries: ["Commercial Real Estate", "Residential"],
    classifications: [
      "maintenance_request",
      "tenant_complaint",
      "lease_question",
      "access_request",
      "vendor_coordination",
    ],
  },
  {
    vertical: "Healthcare",
    industries: ["Clinic", "Urgent Care"],
    classifications: [
      "appointment_request",
      "patient_issue",
      "facility_issue",
      "billing_question",
    ],
  },
  {
    vertical: "Education",
    industries: ["K-12", "Higher Education"],
    classifications: ["facility_issue", "staff_request", "student_support_request"],
  },
  {
    vertical: "Manufacturing",
    industries: ["Discrete Manufacturing", "Process Manufacturing"],
    classifications: ["equipment_issue", "safety_incident", "supply_chain_issue"],
  },
  {
    vertical: "Custom",
    industries: ["General"],
    classifications: ["operational_request"],
  },
];

export function InboxClient({
  initialInboxItems,
  initialWorkItems,
}: InboxClientProps) {
  const [tab, setTab] = useState<Tab>(
    initialInboxItems.length === 0 && initialWorkItems.length === 0 ? "settings" : "inbox",
  );
  const [contextViewMode, setContextViewMode] = useState<ContextViewMode>("operational");
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
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
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
  const [newActionExecutionProvider, setNewActionExecutionProvider] = useState("internal");
  const [newActionOrgUnitId, setNewActionOrgUnitId] = useState("");
  const [newActionDefaultOwnerRole, setNewActionDefaultOwnerRole] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [tenantSubdomain, setTenantSubdomain] = useState("");
  const [tenantVertical, setTenantVertical] = useState(SETUP_PACKS[0].vertical);
  const [tenantIndustry, setTenantIndustry] = useState(SETUP_PACKS[0].industries[0]);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [workMessages, setWorkMessages] = useState<Record<string, string>>({});
  const [selectedActionByWork, setSelectedActionByWork] = useState<Record<string, string>>({});
  const [outcomeStatusByWork, setOutcomeStatusByWork] = useState<Record<string, string>>({});
  const [outcomeFeedbackByWork, setOutcomeFeedbackByWork] = useState<Record<string, string>>({});
  const [outcomeNotesByWork, setOutcomeNotesByWork] = useState<Record<string, string>>({});
  const [orgUnitName, setOrgUnitName] = useState("");
  const [orgUnitType, setOrgUnitType] = useState("team");
  const [orgUnitParentId, setOrgUnitParentId] = useState("");
  const [routingPreviewClassification, setRoutingPreviewClassification] = useState(
    "maintenance_request",
  );
  const [routingPreviewActionName, setRoutingPreviewActionName] = useState("");
  const [routingPreviewSignalContent, setRoutingPreviewSignalContent] = useState("");
  const [routingPreview, setRoutingPreview] = useState<WorkRoutingPreview | null>(null);
  const [businessRules, setBusinessRules] = useState<BusinessRule[]>([]);
  const [businessRuleTitle, setBusinessRuleTitle] = useState("");
  const [businessRuleText, setBusinessRuleText] = useState("");
  const [businessRuleScope, setBusinessRuleScope] = useState("priority");
  const [businessRuleOrgUnitId, setBusinessRuleOrgUnitId] = useState("");
  const [businessRulePriority, setBusinessRulePriority] = useState("100");
  const [businessRuleActive, setBusinessRuleActive] = useState(true);
  const [structuredKeywords, setStructuredKeywords] = useState("");
  const [structuredPriority, setStructuredPriority] = useState("high");
  const [structuredEscalationOrgUnitId, setStructuredEscalationOrgUnitId] = useState("");
  const [vaultKeys, setVaultKeys] = useState<VaultKey[]>([]);
  const [vaultProvider, setVaultProvider] = useState("slack");
  const [vaultKeyName, setVaultKeyName] = useState("slack_bot_token");
  const [vaultSecretValue, setVaultSecretValue] = useState("");
  const [executionsByWork, setExecutionsByWork] = useState<Record<string, ActionExecution[]>>({});
  const [behavioralPatterns, setBehavioralPatterns] = useState<BehavioralPattern[]>([]);
  const [processGraph, setProcessGraph] = useState<ProcessGraph | null>(null);
  const [operationalArtifacts, setOperationalArtifacts] = useState<OperationalArtifact[]>([]);
  const [knowledgeTab, setKnowledgeTab] = useState<OperationalKnowledgeTab>("processes");
  const [artifactQuery, setArtifactQuery] = useState("");
  const selectedSetupPack =
    SETUP_PACKS.find((pack) => pack.vertical === tenantVertical) ?? SETUP_PACKS[0];

  const refresh = useCallback(async () => {
    const tenantQuery = `tenantId=${encodeURIComponent(tenantId)}`;
    const [
      items,
      work,
      tenantList,
      actionList,
      orgUnitList,
      ruleList,
      keyList,
      executionList,
      patternList,
      graph,
      artifactList,
    ] = await Promise.all([
      fetchJson<InboxItem[]>(`/api/items?${tenantQuery}`),
      fetchJson<WorkItem[]>(`/api/work?${tenantQuery}`),
      fetchJson<Tenant[]>("/api/tenants"),
      fetchJson<ActionDefinition[]>(`/api/actions?${tenantQuery}`),
      fetchJson<OrgUnit[]>(`/api/org/units?${tenantQuery}`),
      fetchJson<BusinessRule[]>(`/api/business-rules?${tenantQuery}`),
      fetchJson<VaultKey[]>(`/api/vault/keys?${tenantQuery}`),
      fetchJson<ActionExecution[]>(`/api/executions?${tenantQuery}`),
      fetchJson<BehavioralPattern[]>(`/api/behavioral-patterns?${tenantQuery}`),
      fetchJson<ProcessGraph>(`/api/process-graph?${tenantQuery}`),
      fetchJson<OperationalArtifact[]>(`/api/operational-artifacts?${tenantQuery}`),
    ]);
    setInboxItems(items);
    setWorkItems(work);
    setTenants(tenantList);
    setActions(actionList);
    setOrgUnits(orgUnitList);
    setBusinessRules(ruleList);
    setVaultKeys(keyList);
    setBehavioralPatterns(patternList);
    setProcessGraph(graph);
    setOperationalArtifacts(artifactList);
    const groupedExecutions = executionList.reduce<Record<string, ActionExecution[]>>((acc, execution) => {
      if (!acc[execution.work_item_id]) {
        acc[execution.work_item_id] = [];
      }
      acc[execution.work_item_id].push(execution);
      return acc;
    }, {});
    setExecutionsByWork(groupedExecutions);
    setNewActionOrgUnitId((current) => current || orgUnitList[0]?.id || "");
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
        executionProvider: newActionExecutionProvider,
        assignedOrgUnitId: newActionOrgUnitId || undefined,
        defaultOwnerRole: newActionDefaultOwnerRole || undefined,
        active: true,
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setNewActionName("");
    setNewActionDescription("");
    setNewActionDefaultOwnerRole("");
    setNewActionExecutionProvider("internal");
    await refresh();
  }

  async function onCreateTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSetupMessage(null);

    const response = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: tenantName,
        slug: tenantSubdomain,
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
    setTenantSubdomain("");
    setTenantId(tenant.id);
    setTab("inbox");
    setSetupMessage(
      `We've configured your Operations Inbox for ${tenant.vertical} • ${tenant.industry} at ${tenant.domain ?? `${tenant.id}.canonflo.com`}.`,
    );
  }

  async function onSaveVaultKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/vault/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        provider: vaultProvider,
        keyName: vaultKeyName,
        value: vaultSecretValue,
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setVaultSecretValue("");
    await refresh();
  }

  async function onDeleteVaultKey(key: VaultKey) {
    setError(null);
    const query = new URLSearchParams({
      tenantId,
      keyName: key.key_name,
      provider: key.provider,
    });
    const response = await fetch(`/api/vault/keys?${query.toString()}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    await refresh();
  }

  async function onSelectRecommendedAction(workId: string, actionTitle: string) {
    setError(null);
    setWorkMessages((current) => ({ ...current, [workId]: "" }));
    const response = await fetch(`/api/work/${encodeURIComponent(workId)}/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemAction: actionTitle,
        tenantAction: actionTitle,
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setSelectedActionByWork((current) => ({ ...current, [workId]: actionTitle }));
    setWorkMessages((current) => ({
      ...current,
      [workId]: `Selected action: ${actionTitle}`,
    }));
    await refresh();
  }

  async function onRecordOutcome(event: FormEvent<HTMLFormElement>, workId: string) {
    event.preventDefault();
    setError(null);
    setWorkMessages((current) => ({ ...current, [workId]: "" }));

    const response = await fetch(`/api/work/${encodeURIComponent(workId)}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedActionId: selectedActionByWork[workId],
        status: outcomeStatusByWork[workId] ?? "completed",
        feedback: outcomeFeedbackByWork[workId] ?? "correct",
        resolutionNotes: outcomeNotesByWork[workId],
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setOutcomeNotesByWork((current) => ({ ...current, [workId]: "" }));
    setWorkMessages((current) => ({
      ...current,
      [workId]: "Outcome recorded and learning captured.",
    }));
    await refresh();
  }

  async function onExecuteAction(work: WorkItem) {
    setError(null);
    const selectedActionName = selectedActionByWork[work.id] ?? work.recommended_actions?.[0]?.title;
    if (!selectedActionName) {
      setError("Select or recommend an action before execution.");
      return;
    }

    const selectedAction = actions.find((action) => action.name === selectedActionName);
    const response = await fetch("/api/actions/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        workItemId: work.id,
        actionId: selectedAction?.id,
        actionName: selectedActionName,
        payload: {
          message: `${selectedActionName} for ${work.title}`,
        },
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    await refresh();
  }

  async function onCreateOrgUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/org/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        name: orgUnitName,
        type: orgUnitType,
        parentId: orgUnitParentId || undefined,
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setOrgUnitName("");
    setOrgUnitParentId("");
    await refresh();
  }

  async function onCreateBusinessRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/business-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        orgUnitId: businessRuleOrgUnitId || undefined,
        title: businessRuleTitle,
        ruleText: businessRuleText,
        scope: businessRuleScope,
        active: businessRuleActive,
        priority: Number.parseInt(businessRulePriority, 10) || 100,
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setBusinessRuleTitle("");
    setBusinessRuleText("");
    setBusinessRulePriority("100");
    setBusinessRuleOrgUnitId("");
    await refresh();
  }

  async function onCreateStructuredRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const keywords = structuredKeywords
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const escalationTarget = orgUnitById(structuredEscalationOrgUnitId)?.name;
    const clauses = [];
    if (keywords.length > 0) {
      clauses.push(`If ${keywords.map((keyword) => `\"${keyword}\"`).join(" OR ")}`);
    } else {
      clauses.push("If incoming signal is received");
    }
    clauses.push(`set priority = ${structuredPriority.toUpperCase()}`);
    if (escalationTarget) {
      clauses.push(`escalate to ${escalationTarget}`);
    }
    const ruleText = `${clauses.join(", THEN ")}`;

    const response = await fetch("/api/business-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        title: `Structured rule (${structuredPriority.toUpperCase()})`,
        ruleText,
        scope: escalationTarget ? "escalation" : "priority",
        priority: 200,
      }),
    });
    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setStructuredKeywords("");
    setStructuredEscalationOrgUnitId("");
    await refresh();
  }

  async function loadRoutingPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const query = new URLSearchParams({
      tenantId,
      classificationType: routingPreviewClassification,
    });
    if (routingPreviewActionName.trim()) {
      query.set("actionName", routingPreviewActionName.trim());
    }
    if (routingPreviewSignalContent.trim()) {
      query.set("signalContent", routingPreviewSignalContent.trim());
    }

    try {
      const preview = await fetchJson<WorkRoutingPreview>(
        `/api/work/routing-preview?${query.toString()}`,
      );
      setRoutingPreview(preview);
    } catch (previewError) {
      setRoutingPreview(null);
      setError(previewError instanceof Error ? previewError.message : "Failed loading routing");
    }
  }

  function orgUnitById(orgUnitId: string) {
    return orgUnits.find((orgUnit) => orgUnit.id === orgUnitId);
  }

  function formatRoutingPath(path: string[]) {
    const names = path
      .map((orgUnitId) => orgUnitById(orgUnitId)?.name)
      .filter((name): name is string => Boolean(name));
    return names.join(" / ");
  }

  function routingPathForOrgUnit(orgUnitId: string) {
    const path: string[] = [];
    let currentId: string | undefined = orgUnitId;
    while (currentId) {
      path.push(currentId);
      currentId = orgUnitById(currentId)?.parent_id;
    }
    return path.reverse();
  }

  const selectedInbox = inboxItems.find((item) => item.id === selectedInboxId) ?? null;
  const selectedWork = workItems.find((work) => work.inbox_item_id === selectedInboxId) ?? null;
  const selectedTenant = tenants.find((tenant) => tenant.id === tenantId);
  const normalizedInboundLocalPart = (selectedTenant?.slug ?? tenantId)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  const inboundAddress = `${normalizedInboundLocalPart || "default"}@inbound.canonflo.com`;
  const inferredActionTitles = Array.from(
    new Set(
      workItems.flatMap((work) =>
        (work.recommended_actions ?? []).map((action) => action.title),
      ),
    ),
  ).slice(0, 3);
  const operationalMeaningForWork = (work: WorkItem) => {
    if (!work.operational_meaning) {
      return contextFallback();
    }

    return {
      inferredMeaning: work.operational_meaning.inferred_meaning,
      state: work.operational_meaning.state,
      confidence: work.operational_meaning.confidence,
      evidence: work.operational_meaning.evidence,
    };
  };
  const artifactTypeByKnowledgeTab: Record<OperationalKnowledgeTab, OperationalArtifact["type"]> = {
    processes: "process_map",
    sops: "SOP",
    policies: "policy",
    exceptions: "decision_tree",
    drift: "swimlane",
  };
  const activeArtifactType = artifactTypeByKnowledgeTab[knowledgeTab];
  const normalizedArtifactQuery = artifactQuery.trim().toLowerCase();
  const filteredArtifacts = operationalArtifacts.filter((artifact) => {
    if (artifact.type !== activeArtifactType) {
      return false;
    }
    if (!normalizedArtifactQuery) {
      return true;
    }
    const haystack = `${artifact.name} ${artifact.type} ${JSON.stringify(artifact.content)}`.toLowerCase();
    return haystack.includes(normalizedArtifactQuery);
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">Operations Inbox</h1>
        <div className="flex flex-wrap items-center gap-2">
          {(["inbox", "work", "actions", "organization", "rules", "truth", "settings"] as Tab[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`rounded border dark:border-zinc-700 px-3 py-1 text-sm capitalize ${
                tab === name ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "bg-white dark:bg-zinc-800"
              }`}
            >
              {name}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1 rounded border dark:border-zinc-700 p-1 text-xs dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => setContextViewMode("raw")}
              className={`rounded px-2 py-1 ${
                contextViewMode === "raw" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
              }`}
            >
              Raw View
            </button>
            <button
              type="button"
              onClick={() => setContextViewMode("operational")}
              className={`rounded px-2 py-1 ${
                contextViewMode === "operational" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
              }`}
            >
              Operational View
            </button>
          </div>
          <select
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            className="rounded border dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 px-2 py-1 text-sm"
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
        <div className="rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {tab === "inbox" ? (
        <>
          <section className="space-y-4 rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
            <h2 className="text-lg font-semibold dark:text-zinc-100">Live Operational Feed (Inferred)</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Incoming Signals
                </p>
                <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {inboxItems.slice(0, 3).map((item) => (
                    <li key={`inferred-signal-${item.id}`} className="rounded border dark:border-zinc-700 dark:bg-zinc-700 px-2 py-1">
                      {item.content}
                    </li>
                  ))}
                  {inboxItems.length === 0 ? <li>No signals yet.</li> : null}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Interpretation Layer
                </p>
                <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {workItems.slice(0, 3).map((work) => {
                    const context = operationalMeaningForWork(work);
                    return (
                      <li key={`inferred-work-${work.id}`} className="rounded border dark:border-zinc-700 dark:bg-zinc-700 px-2 py-1">
                        {work.classification_type} ({(context.confidence * 100).toFixed(0)}%) → {context.inferredMeaning}
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Reason: {work.summary}</p>
                      </li>
                    );
                  })}
                  {workItems.length === 0 ? <li>No interpretations yet.</li> : null}
                </ul>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Suggested Actions
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {inferredActionTitles.map((title) => (
                  <span key={`inferred-action-${title}`} className="rounded border dark:border-zinc-700 dark:bg-zinc-700 px-2 py-1 text-xs">
                    {title}
                  </span>
                ))}
                {inferredActionTitles.length === 0 ? (
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">No actions generated yet.</span>
                ) : null}
              </div>
            </div>
            <div className="rounded border dark:border-zinc-700 dark:bg-zinc-700 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Connect Real Ingress
              </p>
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">Inbound address: {inboundAddress}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="rounded border dark:border-zinc-600 px-3 py-1 text-xs">Connect Email (Postmark)</button>
                <a href={`mailto:${inboundAddress}`} className="rounded border dark:border-zinc-600 px-3 py-1 text-xs">Send Test Email</a>
                <button type="button" onClick={() => setSource("simulation")} className="rounded border dark:border-zinc-600 px-3 py-1 text-xs">
                  Use Simulation Mode
                </button>
              </div>
            </div>
          </section>

          <form onSubmit={onSubmit} className="space-y-3 rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
            <label className="block text-sm font-medium dark:text-zinc-300" htmlFor="source">
              Signal source
            </label>
            <input
              id="source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="w-full rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
            />
            <label className="block text-sm font-medium dark:text-zinc-300" htmlFor="content">
              Feed operational signal
            </label>
            <textarea
              id="content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={4}
              className="w-full rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-black dark:bg-zinc-100 px-4 py-2 text-white dark:text-zinc-900 disabled:opacity-60"
            >
              {loading ? "Feeding..." : "Feed signal"}
            </button>
          </form>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
              <h2 className="mb-3 text-lg font-semibold dark:text-zinc-100">Inbox</h2>
              <div className="space-y-2">
                {inboxItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedInboxId(item.id)}
                    className={`w-full rounded border dark:border-zinc-600 px-3 py-2 text-left text-sm ${
                      selectedInboxId === item.id ? "bg-zinc-100 dark:bg-zinc-700" : "bg-white dark:bg-zinc-800"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="font-medium dark:text-zinc-100">{item.source}</p>
                      <IngressStatusBadge status={item.status} />
                    </div>
                    <p className="line-clamp-2 text-zinc-600 dark:text-zinc-400">{item.content}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
              <h2 className="mb-3 text-lg font-semibold dark:text-zinc-100">Detail</h2>
              {selectedInbox ? (
                <div className="space-y-3 text-sm">
                  <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{selectedInbox.content}</p>
                  {selectedWork ? (
                    <>
                      <div className="rounded border dark:border-zinc-600 dark:bg-zinc-700 p-3">
                        {(() => {
                          const context = operationalMeaningForWork(selectedWork);
                          return (
                            <>
                        <p className="font-medium dark:text-zinc-100">{selectedWork.title}</p>
                        <p className="text-zinc-700 dark:text-zinc-300">{selectedWork.summary}</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Classification: {selectedWork.classification_type}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Assigned Team:{" "}
                          {orgUnitById(selectedWork.assigned_org_unit_id)?.name ?? "Unassigned"}
                        </p>
                              {contextViewMode === "operational" ? (
                                <div className="mt-2 space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                                  <p>
                                    <span className="font-medium dark:text-zinc-200">Meaning:</span> {context.inferredMeaning}
                                  </p>
                                  <p>
                                    <span className="font-medium dark:text-zinc-200">Truth State:</span> {context.state}
                                  </p>
                                  <p>
                                    <span className="font-medium dark:text-zinc-200">Confidence:</span>{" "}
                                    {(context.confidence * 100).toFixed(0)}%
                                  </p>
                                  <p>
                                    <span className="font-medium dark:text-zinc-200">Evidence:</span>{" "}
                                    {context.evidence.length > 0
                                      ? context.evidence.join(" • ")
                                      : "No evidence recorded"}
                                  </p>
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                      <IngressRecommendationsCard
                        recommendations={selectedWork.recommended_actions ?? []}
                      />
                    </>
                  ) : null}
                  <IngressTimeline events={timeline} />
                </div>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Select an inbox item.</p>
              )}
            </section>
          </div>
        </>
      ) : null}

      {tab === "work" ? (
        <section className="rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
          <h2 className="mb-3 text-lg font-semibold dark:text-zinc-100">Work</h2>
          {contextViewMode === "raw" ? (
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              Raw view is intentionally reduced and omits operational interpretation.
            </p>
          ) : null}
          <div className="space-y-2">
            {workItems.map((work) => (
              <div key={work.id} className="rounded border dark:border-zinc-700 dark:bg-zinc-700 p-3 text-sm">
                {(() => {
                  const context = operationalMeaningForWork(work);
                  return (
                    <>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium dark:text-zinc-100">{work.title}</p>
                  <IngressStatusBadge status={work.status} />
                </div>
                <p className="text-zinc-700 dark:text-zinc-300">{work.summary}</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Classification: {work.classification_type}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Priority: {(work.priority ?? "medium").toUpperCase()}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Assigned Team: {orgUnitById(work.assigned_org_unit_id)?.name ?? "Unassigned"}
                </p>
                {work.escalation_target ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Escalation: {work.escalation_target}</p>
                ) : null}
                {work.suppress_action ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Execution suppressed by business rule</p>
                ) : null}
                {work.require_approval ? (
                  <p className="text-xs text-blue-700 dark:text-blue-300">Approval required before execution</p>
                ) : null}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Location in Org: {formatRoutingPath(work.routing_path) || "Not routed"}
                </p>
                      {contextViewMode === "operational" ? (
                        <div className="mt-2 rounded border dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-600 p-2 text-xs text-zinc-700 dark:text-zinc-200">
                         <p>
                            <span className="font-medium dark:text-zinc-100">Meaning:</span> {context.inferredMeaning}
                          </p>
                          <p>
                            <span className="font-medium dark:text-zinc-100">Truth State:</span> {context.state}
                          </p>
                          <p>
                            <span className="font-medium dark:text-zinc-100">Evidence:</span>{" "}
                            {context.evidence.length > 0
                              ? context.evidence.join(" • ")
                              : "No evidence recorded"}
                          </p>
                          <p>
                            <span className="font-medium dark:text-zinc-100">Confidence:</span>{" "}
                            {(context.confidence * 100).toFixed(0)}%
                          </p>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
                {(work.applied_rules ?? []).length > 0 ? (
                  <div className="mt-1 rounded border dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-600 p-2 text-xs text-zinc-600 dark:text-zinc-300">
                    {(work.applied_rules ?? []).map((rule) => (
                      <p key={rule.rule_id}>
                        {rule.title}: {rule.effect_summary}
                      </p>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 rounded border dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-600 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Suggested Actions
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(work.recommended_actions ?? []).map((action, index) => (
                      <button
                        key={`${work.id}-recommended-${index}`}
                        type="button"
                        onClick={() => void onSelectRecommendedAction(work.id, action.title)}
                        className="rounded border dark:border-zinc-500 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600 bg-white px-2 py-1 text-xs hover:bg-zinc-100"
                      >
                        {action.title}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(event) => void onRecordOutcome(event, work.id)}
                    className="mt-3 grid gap-2 md:grid-cols-4"
                  >
                    <select
                      value={outcomeStatusByWork[work.id] ?? "completed"}
                      onChange={(event) =>
                        setOutcomeStatusByWork((current) => ({
                          ...current,
                          [work.id]: event.target.value,
                        }))
                      }
                      className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 px-2 py-1 text-xs"
                    >
                      <option value="completed">Completed</option>
                      <option value="failed">Failed</option>
                      <option value="escalated">Escalated</option>
                      <option value="duplicate">Duplicate</option>
                      <option value="irrelevant">Irrelevant</option>
                    </select>
                    <select
                      value={outcomeFeedbackByWork[work.id] ?? "correct"}
                      onChange={(event) =>
                        setOutcomeFeedbackByWork((current) => ({
                          ...current,
                          [work.id]: event.target.value,
                        }))
                      }
                      className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 px-2 py-1 text-xs"
                    >
                      <option value="correct">✅ Correct action</option>
                      <option value="wrong">❌ Wrong action</option>
                      <option value="partial">⚠️ Partially correct</option>
                      <option value="escalated">➜ Needed escalation</option>
                    </select>
                    <input
                      value={outcomeNotesByWork[work.id] ?? ""}
                      onChange={(event) =>
                        setOutcomeNotesByWork((current) => ({
                          ...current,
                          [work.id]: event.target.value,
                        }))
                      }
                      className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 px-2 py-1 text-xs md:col-span-2"
                      placeholder="Resolution notes (optional)"
                    />
                    <button
                      type="submit"
                      className="rounded bg-black dark:bg-zinc-100 px-3 py-1 text-xs text-white dark:text-zinc-900 md:col-span-4"
                    >
                      Record Outcome
                    </button>
                  </form>
                  {workMessages[work.id] ? (
                    <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{workMessages[work.id]}</p>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    <button
                      type="button"
                      onClick={() => void onExecuteAction(work)}
                      className="rounded bg-zinc-900 dark:bg-zinc-100 px-3 py-1 text-xs text-white dark:text-zinc-900"
                    >
                      Execute Selected Action
                    </button>
                    <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {(executionsByWork[work.id] ?? []).map((execution) => (
                        <p key={execution.id}>
                          {execution.status === "success" ? "✔" : execution.status === "failed" ? "✖" : "…" }{" "}
                          {execution.provider.toUpperCase()} {execution.status}
                          {execution.summary ? ` — ${execution.summary}` : execution.message ? ` — ${execution.message}` : ""}
                          {execution.side_effects?.length ? ` (${execution.side_effects.map((effect) => effect.description).join("; ")})` : ""}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "actions" ? (
        <section className="rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
          <h2 className="mb-3 text-lg font-semibold dark:text-zinc-100">Action Studio</h2>
          <form onSubmit={onCreateAction} className="mb-4 grid gap-2 md:grid-cols-2">
            <input
              value={newActionName}
              onChange={(event) => setNewActionName(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Action Name"
              required
            />
            <input
              value={newActionCategory}
              onChange={(event) => setNewActionCategory(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Category"
              required
            />
            <input
              value={newActionClassification}
              onChange={(event) => setNewActionClassification(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Classification Type"
              required
            />
            <input
              value={newActionDescription}
              onChange={(event) => setNewActionDescription(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Description"
              required
            />
            <select
              value={newActionExecutionProvider}
              onChange={(event) => setNewActionExecutionProvider(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
            >
              <option value="internal">Internal only</option>
              <option value="slack">Slack</option>
              <option value="jira">Jira</option>
              <option value="email">Email</option>
              <option value="webhook">Webhook</option>
              <option value="nango">External integration (Nango)</option>
            </select>
            <select
              value={newActionOrgUnitId}
              onChange={(event) => setNewActionOrgUnitId(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              required
            >
              {orgUnits.map((orgUnit) => (
                <option key={orgUnit.id} value={orgUnit.id}>
                  {orgUnit.name} ({orgUnit.type})
                </option>
              ))}
            </select>
            <input
              value={newActionDefaultOwnerRole}
              onChange={(event) => setNewActionDefaultOwnerRole(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Default Owner Role (optional)"
            />
            <button type="submit" className="rounded bg-black dark:bg-zinc-100 px-4 py-2 text-white dark:text-zinc-900">
              Add Action
            </button>
          </form>
          <div className="space-y-2">
            {actions.map((action) => (
              <div key={action.id} className="rounded border dark:border-zinc-700 dark:bg-zinc-700 p-3 text-sm">
                <p className="font-medium dark:text-zinc-100">{action.name}</p>
                <p className="text-zinc-700 dark:text-zinc-300">{action.description}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {action.category} • {action.classification_types.join(", ")}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Assigned Team:{" "}
                  {orgUnitById(action.assigned_org_unit_id)?.name ?? "Unknown team"}
                  {action.default_owner_role ? ` • Owner Role: ${action.default_owner_role}` : ""}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Execution Target: {(action.execution_provider ?? "internal").toUpperCase()}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "organization" ? (
        <section className="space-y-4 rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
          <h2 className="text-lg font-semibold dark:text-zinc-100">Organization Model</h2>
          <form onSubmit={onCreateOrgUnit} className="grid gap-2 md:grid-cols-4">
            <input
              value={orgUnitName}
              onChange={(event) => setOrgUnitName(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Org Unit Name"
              required
            />
            <select
              value={orgUnitType}
              onChange={(event) => setOrgUnitType(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
            >
              <option value="department">Department</option>
              <option value="team">Team</option>
              <option value="vendor">Vendor</option>
              <option value="role">Role</option>
              <option value="location">Location</option>
            </select>
            <select
              value={orgUnitParentId}
              onChange={(event) => setOrgUnitParentId(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
            >
              <option value="">No Parent</option>
              {orgUnits.map((orgUnit) => (
                <option key={orgUnit.id} value={orgUnit.id}>
                  {orgUnit.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-black dark:bg-zinc-100 px-4 py-2 text-white dark:text-zinc-900">
              Add Org Unit
            </button>
          </form>

          <div className="rounded border dark:border-zinc-700 dark:bg-zinc-700 p-3 text-sm">
            <p className="mb-2 font-medium dark:text-zinc-100">Current Org Structure</p>
            <div className="space-y-1 text-zinc-700 dark:text-zinc-300">
              {orgUnits.map((orgUnit) => (
                <p key={orgUnit.id}>
                  {formatRoutingPath(routingPathForOrgUnit(orgUnit.id)) || orgUnit.name}
                </p>
              ))}
            </div>
          </div>

          <form onSubmit={loadRoutingPreview} className="grid gap-2 md:grid-cols-4">
            <input
              value={routingPreviewClassification}
              onChange={(event) => setRoutingPreviewClassification(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Classification Type"
              required
            />
            <input
              value={routingPreviewActionName}
              onChange={(event) => setRoutingPreviewActionName(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Action Name (optional)"
            />
            <input
              value={routingPreviewSignalContent}
              onChange={(event) => setRoutingPreviewSignalContent(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Signal Content (optional)"
            />
            <button type="submit" className="rounded bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-white dark:text-zinc-900 md:col-span-2">
              Preview Routing
            </button>
          </form>
          {routingPreview ? (
            <div className="rounded border dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-700 p-3 text-sm dark:text-zinc-200">
              <p>Classification: {routingPreview.classification_type}</p>
              <p>Action: {routingPreview.action_name ?? "Auto-selected"}</p>
              <p>Priority: {(routingPreview.priority ?? "medium").toUpperCase()}</p>
              <p>Assigned Team: {routingPreview.assigned_org_unit?.name ?? "No route found"}</p>
              {routingPreview.escalation_target ? (
                <p>Escalation Target: {routingPreview.escalation_target}</p>
              ) : null}
              {routingPreview.suppress_action ? <p>Execution: Suppressed by rule</p> : null}
              {routingPreview.require_approval ? <p>Execution: Approval required</p> : null}
              <p>
                Location in Org:{" "}
                {routingPreview.routing_path.map((orgUnit) => orgUnit.name).join(" / ") || "N/A"}
              </p>
              {(routingPreview.applied_rules ?? []).length > 0 ? (
                <div className="mt-2 rounded border dark:border-zinc-600 bg-white dark:bg-zinc-600 p-2 text-xs text-zinc-600 dark:text-zinc-300">
                  {(routingPreview.applied_rules ?? []).map((rule) => (
                    <p key={rule.rule_id}>
                      {rule.title}: {rule.effect_summary}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "rules" ? (
        <section className="space-y-4 rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
          <h2 className="text-lg font-semibold dark:text-zinc-100">Business Rules</h2>
          <form onSubmit={onCreateBusinessRule} className="grid gap-2 md:grid-cols-3">
            <input
              value={businessRuleTitle}
              onChange={(event) => setBusinessRuleTitle(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Rule Title"
              required
            />
            <select
              value={businessRuleScope}
              onChange={(event) => setBusinessRuleScope(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
            >
              <option value="routing">routing</option>
              <option value="priority">priority</option>
              <option value="escalation">escalation</option>
              <option value="execution">execution</option>
              <option value="classification_override">classification_override</option>
            </select>
            <input
              value={businessRulePriority}
              onChange={(event) => setBusinessRulePriority(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Priority Number"
            />
            <select
              value={businessRuleOrgUnitId}
              onChange={(event) => setBusinessRuleOrgUnitId(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
            >
              <option value="">Tenant-wide rule</option>
              {orgUnits.map((orgUnit) => (
                <option key={orgUnit.id} value={orgUnit.id}>
                  {orgUnit.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={businessRuleActive}
                onChange={(event) => setBusinessRuleActive(event.target.checked)}
              />
              Active
            </label>
            <button type="submit" className="rounded bg-black dark:bg-zinc-100 px-4 py-2 text-white dark:text-zinc-900">
              Save Plain-English Rule
            </button>
            <textarea
              value={businessRuleText}
              onChange={(event) => setBusinessRuleText(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2 md:col-span-3"
              rows={3}
              placeholder='Example: If "no heat" then set priority = HIGH and escalate to Operations'
              required
            />
          </form>

          <form onSubmit={onCreateStructuredRule} className="grid gap-2 rounded border dark:border-zinc-700 dark:bg-zinc-700 p-3 md:grid-cols-4">
            <input
              value={structuredKeywords}
              onChange={(event) => setStructuredKeywords(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-600 dark:text-zinc-100 px-3 py-2"
              placeholder='IF keywords (comma-separated, e.g. "no heat,no water")'
            />
            <select
              value={structuredPriority}
              onChange={(event) => setStructuredPriority(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-600 dark:text-zinc-100 px-3 py-2"
            >
              <option value="high">THEN priority HIGH</option>
              <option value="medium">THEN priority MEDIUM</option>
              <option value="low">THEN priority LOW</option>
            </select>
            <select
              value={structuredEscalationOrgUnitId}
              onChange={(event) => setStructuredEscalationOrgUnitId(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-600 dark:text-zinc-100 px-3 py-2"
            >
              <option value="">No escalation</option>
              {orgUnits.map((orgUnit) => (
                <option key={orgUnit.id} value={orgUnit.id}>
                  Escalate to {orgUnit.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-zinc-900 dark:bg-zinc-500 dark:hover:bg-zinc-400 px-4 py-2 text-white dark:text-zinc-900">
              Save Structured Rule
            </button>
          </form>

          <div className="space-y-2">
            {businessRules.map((rule) => (
              <div key={rule.id} className="rounded border dark:border-zinc-700 dark:bg-zinc-700 p-3 text-sm">
                <p className="font-medium dark:text-zinc-100">
                  {rule.title} <span className="text-xs text-zinc-500 dark:text-zinc-400">({rule.scope})</span>
                </p>
                <p className="text-zinc-700 dark:text-zinc-300">{rule.rule_text}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Scope: {rule.org_unit_id ? orgUnitById(rule.org_unit_id)?.name ?? "Org unit" : "Tenant-wide"} •
                  Priority: {rule.priority} • {rule.active ? "Active" : "Inactive"}
                </p>
              </div>
            ))}
            {businessRules.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">No business rules configured yet.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "truth" ? (
        <section className="space-y-4 rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
          <h2 className="text-lg font-semibold dark:text-zinc-100">How Your Organization Works</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Living operational artifacts generated from observed behavior.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(["processes", "sops", "policies", "exceptions", "drift"] as OperationalKnowledgeTab[]).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setKnowledgeTab(name)}
                className={`rounded border dark:border-zinc-700 px-3 py-1 text-xs uppercase ${
                  knowledgeTab === name ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "bg-white dark:bg-zinc-700"
                }`}
              >
                {name}
              </button>
            ))}
            <input
              value={artifactQuery}
              onChange={(event) => setArtifactQuery(event.target.value)}
              className="ml-auto rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-2 py-1 text-xs"
              placeholder="Artifact query"
            />
          </div>
          <div className="space-y-2">
            {filteredArtifacts.map((artifact) => (
              <div key={`${artifact.type}-${artifact.name}`} className="rounded border dark:border-zinc-700 dark:bg-zinc-700 p-3 text-sm">
                <p className="font-medium dark:text-zinc-100">{artifact.name}</p>
                <p className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                  {artifact.type} • {artifact.source} • v{artifact.version}
                </p>
                <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 dark:bg-zinc-900 p-2 text-xs text-zinc-700 dark:text-zinc-300">
                  {JSON.stringify(artifact.content, null, 2)}
                </pre>
              </div>
            ))}
            {filteredArtifacts.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">No artifacts match this query yet.</p>
            ) : null}
          </div>
          {processGraph ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Current drift score: {processGraph.drift_score.toFixed(2)}
            </p>
          ) : null}
          <div className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            {behavioralPatterns.slice(0, 3).map((pattern) => (
              <p key={pattern.id}>
                {pattern.pattern_type}: {(pattern.confidence * 100).toFixed(0)}% confidence
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="rounded-lg border dark:border-zinc-700 dark:bg-zinc-800 p-4">
          <h2 className="mb-3 text-lg font-semibold dark:text-zinc-100">Setup Experience</h2>
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            What kind of organization are you?
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            {SETUP_PACKS.map((pack) => (
              <button
                key={pack.vertical}
                type="button"
                onClick={() => {
                  setTenantVertical(pack.vertical);
                  setTenantIndustry(pack.industries[0]);
                }}
                className={`rounded border dark:border-zinc-700 px-3 py-1 text-sm ${
                  tenantVertical === pack.vertical ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "bg-white dark:bg-zinc-700"
                }`}
              >
                {pack.vertical}
              </button>
            ))}
          </div>
          <form onSubmit={onCreateTenant} className="grid gap-2 md:grid-cols-2">
            <input
              value={tenantName}
              onChange={(event) => setTenantName(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Organization Name"
              required
            />
            <input
              value={tenantSubdomain}
              onChange={(event) => setTenantSubdomain(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
              placeholder="Subdomain (e.g. acme)"
              required
            />
            <input value={tenantVertical} className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2" readOnly />
            <select
              value={tenantIndustry}
              onChange={(event) => setTenantIndustry(event.target.value)}
              className="rounded border dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 px-3 py-2"
            >
              {selectedSetupPack.industries.map((industry) => (
                <option key={industry} value={industry}>
                  {industry}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-black dark:bg-zinc-100 px-4 py-2 text-white dark:text-zinc-900">
              Create Tenant
            </button>
          </form>
          <p className="mt-4 text-sm font-medium dark:text-zinc-100">Incoming Signals ready on day 1</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedSetupPack.classifications.map((classification) => (
              <span key={classification} className="rounded border dark:border-zinc-700 dark:bg-zinc-700 dark:text-zinc-200 px-2 py-1 text-xs">
                {classification}
              </span>
            ))}
          </div>
          {setupMessage ? (
            <p className="mt-4 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-200">
              {setupMessage}
            </p>
          ) : null}
          <div className="mt-6 rounded border dark:border-zinc-700 dark:bg-zinc-700 p-4">
            <h3 className="mb-2 text-base font-semibold dark:text-zinc-100">Integrations Vault</h3>
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              Connected systems are managed per tenant. Credentials are encrypted server-side.
            </p>
            <div className="mb-3 grid gap-2 text-sm md:grid-cols-2">
              <div className="rounded border dark:border-zinc-700 dark:bg-zinc-600 p-2">
                <p className="font-medium dark:text-zinc-100">Slack</p>
                <p className="text-zinc-600 dark:text-zinc-400">Connect / Configure</p>
              </div>
              <div className="rounded border dark:border-zinc-700 dark:bg-zinc-600 p-2">
                <p className="font-medium dark:text-zinc-100">Jira</p>
                <p className="text-zinc-600 dark:text-zinc-400">Connect / Configure</p>
              </div>
              <div className="rounded border dark:border-zinc-700 dark:bg-zinc-600 p-2">
                <p className="font-medium dark:text-zinc-100">Email (SMTP)</p>
                <p className="text-zinc-600 dark:text-zinc-400">Add Credentials</p>
              </div>
              <div className="rounded border dark:border-zinc-700 dark:bg-zinc-600 p-2">
                <p className="font-medium dark:text-zinc-100">Webhook Endpoints</p>
                <p className="text-zinc-600 dark:text-zinc-400">Create Endpoint</p>
              </div>
            </div>
            <form onSubmit={onSaveVaultKey} className="grid gap-2 md:grid-cols-4">
              <select
                value={vaultProvider}
                onChange={(event) => setVaultProvider(event.target.value)}
                className="rounded border dark:border-zinc-600 dark:bg-zinc-600 dark:text-zinc-100 px-3 py-2"
              >
                <option value="slack">Slack</option>
                <option value="jira">Jira</option>
                <option value="email">Email</option>
                <option value="webhook">Webhook</option>
                <option value="nango">External integration (Nango)</option>
              </select>
              <input
                value={vaultKeyName}
                onChange={(event) => setVaultKeyName(event.target.value)}
                className="rounded border dark:border-zinc-600 dark:bg-zinc-600 dark:text-zinc-100 px-3 py-2"
                placeholder="Key name (e.g. slack_bot_token)"
                required
              />
              <input
                value={vaultSecretValue}
                onChange={(event) => setVaultSecretValue(event.target.value)}
                className="rounded border dark:border-zinc-600 dark:bg-zinc-600 dark:text-zinc-100 px-3 py-2"
                placeholder="Secret value"
                required
              />
              <button type="submit" className="rounded bg-zinc-900 dark:bg-zinc-500 dark:hover:bg-zinc-400 px-4 py-2 text-white dark:text-zinc-900">
                Save Key
              </button>
            </form>
            <div className="mt-3 space-y-2">
              {vaultKeys.map((key) => (
                <div key={key.id} className="flex items-center justify-between rounded border dark:border-zinc-700 dark:bg-zinc-600 px-3 py-2 text-sm dark:text-zinc-200">
                  <p>
                    {key.provider.toUpperCase()} • {key.key_name}
                  </p>
                  <button
                    type="button"
                    onClick={() => void onDeleteVaultKey(key)}
                    className="rounded border dark:border-zinc-500 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600 px-2 py-1 text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
