import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  signal_events: defineTable({
    tenantId: v.string(),
    sourceType: v.string(),
    rawPayload: v.any(),
    normalizedContent: v.string(),
    metadata: v.object({
      sender: v.optional(v.string()),
      timestamp: v.number(),
      channel: v.optional(v.string()),
    }),
  }),
  inbox_items: defineTable({
    tenantId: v.string(),
    externalId: v.string(),
    source: v.string(),
    receivedAt: v.string(),
    content: v.string(),
    status: v.string(),
    statusUpdatedAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_tenant_external_id", ["tenantId", "externalId"]),
  ingress_events: defineTable({
    tenantId: v.string(),
    ingressId: v.id("inbox_items"),
    eventType: v.string(),
    description: v.string(),
    createdAt: v.number(),
  })
    .index("by_ingress_id_created_at", ["ingressId", "createdAt"])
    .index("by_tenant_created_at", ["tenantId", "createdAt"]),
  work_items: defineTable({
    tenantId: v.string(),
    externalId: v.string(),
    inboxExternalId: v.string(),
    classificationType: v.string(),
    title: v.string(),
    summary: v.string(),
    status: v.string(),
    assignedOrgUnitId: v.id("org_units"),
    currentOwnerId: v.optional(v.string()),
    routingPath: v.array(v.id("org_units")),
    recommendedActions: v.optional(
      v.array(
        v.object({
          title: v.string(),
          description: v.string(),
          actionType: v.string(),
        }),
      ),
    ),
  })
    .index("by_external_id", ["externalId"])
    .index("by_inbox_external_id", ["inboxExternalId"])
    .index("by_tenant_external_id", ["tenantId", "externalId"])
    .index("by_tenant_inbox_external_id", ["tenantId", "inboxExternalId"]),
  operational_context: defineTable({
    tenantId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    summary: v.string(),
    businessMeaning: v.string(),
    operationalImpact: v.string(),
    downstreamEffects: v.array(v.string()),
    riskLevel: v.string(),
    urgency: v.string(),
    relatedProcesses: v.array(v.string()),
    lastComputedAt: v.number(),
  })
    .index("by_tenant_entity", ["tenantId", "entityType", "entityId"])
    .index("by_tenant_entity_type", ["tenantId", "entityType"]),
  users: defineTable({
    tenantId: v.optional(v.string()),
    handle: v.optional(v.string()),
    role: v.optional(v.string()),
    orgUnitId: v.optional(v.id("org_units")),
    email: v.string(),
    name: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_tenant_handle", ["tenantId", "handle"]),
  roles: defineTable({
    tenantId: v.string(),
    name: v.string(),
    permissions: v.array(v.string()),
    scopes: v.array(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),
  tenants: defineTable({
    id: v.string(),
    slug: v.string(),
    displayName: v.string(),
    vertical: v.string(),
    industry: v.string(),
  }).index("by_slug", ["slug"]),
  org_units: defineTable({
    tenantId: v.string(),
    name: v.string(),
    type: v.string(),
    parentId: v.optional(v.id("org_units")),
    metadata: v.optional(v.any()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),
  core_classifications: defineTable({
    key: v.string(),
    label: v.string(),
  }).index("by_key", ["key"]),
  verticals: defineTable({
    name: v.string(),
  }).index("by_name", ["name"]),
  industries: defineTable({
    vertical: v.string(),
    name: v.string(),
  })
    .index("by_name", ["name"])
    .index("by_vertical_name", ["vertical", "name"]),
  actions: defineTable({
    tenantId: v.string(),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    classificationTypes: v.array(v.string()),
    assignedOrgUnitId: v.id("org_units"),
    defaultOwnerRole: v.optional(v.string()),
    active: v.boolean(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),
  business_rules: defineTable({
    tenantId: v.string(),
    orgUnitId: v.optional(v.id("org_units")),
    title: v.string(),
    ruleText: v.string(),
    scope: v.string(),
    active: v.boolean(),
    priority: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_scope", ["tenantId", "scope"])
    .index("by_tenant_org_unit", ["tenantId", "orgUnitId"]),
  tenant_classifications: defineTable({
    tenantId: v.string(),
    type: v.string(),
    description: v.string(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_type", ["tenantId", "type"]),
  term_mappings: defineTable({
    tenantId: v.string(),
    systemTerm: v.string(),
    tenantTerm: v.string(),
    type: v.string(),
    confidence: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_system_term_type", ["tenantId", "systemTerm", "type"])
    .index("by_tenant_tenant_term_type", ["tenantId", "tenantTerm", "type"]),
  action_mappings: defineTable({
    tenantId: v.string(),
    systemAction: v.string(),
    tenantAction: v.string(),
    confidence: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_system_action", ["tenantId", "systemAction"])
    .index("by_tenant_tenant_action", ["tenantId", "tenantAction"]),
  action_selections: defineTable({
    tenantId: v.string(),
    workItemId: v.id("work_items"),
    systemAction: v.string(),
    tenantAction: v.string(),
    selectedAt: v.number(),
  })
    .index("by_work_item_selected_at", ["workItemId", "selectedAt"])
    .index("by_tenant_selected_at", ["tenantId", "selectedAt"]),
  work_outcomes: defineTable({
    tenantId: v.string(),
    workItemId: v.id("work_items"),
    selectedActionId: v.optional(v.string()),
    status: v.string(),
    resolutionNotes: v.optional(v.string()),
    feedback: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  })
    .index("by_work_item_completed_at", ["workItemId", "completedAt"])
    .index("by_tenant_completed_at", ["tenantId", "completedAt"]),
  execution_results: defineTable({
    tenantId: v.string(),
    workItemId: v.id("work_items"),
    executedBy: v.string(),
    executionType: v.string(),
    status: v.string(),
    resultType: v.string(),
    summary: v.string(),
    payload: v.any(),
    sideEffects: v.array(
      v.object({
        type: v.string(),
        targetSystem: v.optional(v.string()),
        targetId: v.optional(v.string()),
        description: v.string(),
      }),
    ),
    contextSnapshot: v.any(),
    timestamp: v.number(),
  })
    .index("by_work_item_timestamp", ["workItemId", "timestamp"])
    .index("by_tenant_timestamp", ["tenantId", "timestamp"]),
  assignments: defineTable({
    tenantId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    userId: v.id("users"),
    responsibilityType: v.string(),
    createdAt: v.number(),
  })
    .index("by_tenant_entity", ["tenantId", "entityType", "entityId"])
    .index("by_tenant_user", ["tenantId", "userId"]),
  messages: defineTable({
    tenantId: v.string(),
    authorUserId: v.id("users"),
    targetType: v.string(),
    targetId: v.string(),
    type: v.string(),
    content: v.string(),
    createdAt: v.number(),
  })
    .index("by_tenant_target_created_at", ["tenantId", "targetType", "targetId", "createdAt"])
    .index("by_tenant_author_created_at", ["tenantId", "authorUserId", "createdAt"]),
  notifications: defineTable({
    tenantId: v.string(),
    userId: v.id("users"),
    triggerType: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_tenant_user_created_at", ["tenantId", "userId", "createdAt"])
    .index("by_tenant_user_read", ["tenantId", "userId", "read"]),
  work_states: defineTable({
    tenantId: v.string(),
    workItemId: v.id("work_items"),
    state: v.string(),
    transitionedBy: v.string(),
    reason: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_work_item_timestamp", ["workItemId", "timestamp"])
    .index("by_tenant_timestamp", ["tenantId", "timestamp"]),
  tenant_secrets: defineTable({
    tenantId: v.string(),
    keyName: v.string(),
    encryptedValue: v.string(),
    provider: v.string(),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_provider", ["tenantId", "provider"]),
  behavioral_patterns: defineTable({
    tenantId: v.string(),
    patternType: v.string(),
    description: v.string(),
    evidence: v.any(),
    confidence: v.number(),
    impactScore: v.number(),
    firstObservedAt: v.number(),
    lastObservedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_pattern_type", ["tenantId", "patternType"]),
  process_nodes: defineTable({
    tenantId: v.string(),
    orgUnitId: v.optional(v.id("org_units")),
    name: v.string(),
    type: v.string(),
    source: v.string(),
    confidence: v.number(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"])
    .index("by_tenant_type", ["tenantId", "type"]),
  process_edges: defineTable({
    tenantId: v.string(),
    fromNodeId: v.id("process_nodes"),
    toNodeId: v.id("process_nodes"),
    transitionType: v.string(),
    frequency: v.number(),
    confidence: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_from_to", ["tenantId", "fromNodeId", "toNodeId"]),
  operational_artifacts: defineTable({
    tenantId: v.string(),
    name: v.string(),
    type: v.string(),
    orgUnitId: v.optional(v.id("org_units")),
    source: v.string(),
    version: v.number(),
    content: v.any(),
    derivedFrom: v.array(v.string()),
    lastUpdatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_type", ["tenantId", "type"]),
  operational_packs: defineTable({
    vertical: v.string(),
    industry: v.string(),
    classifications: v.array(
      v.object({
        type: v.string(),
        description: v.string(),
      }),
    ),
    actions: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
        classificationTypes: v.array(v.string()),
      }),
    ),
  }).index("by_vertical_industry", ["vertical", "industry"]),
});
