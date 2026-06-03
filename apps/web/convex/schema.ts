import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
  }).index("by_email", ["email"]),
  tenants: defineTable({
    id: v.string(),
    slug: v.string(),
    displayName: v.string(),
    vertical: v.string(),
    industry: v.string(),
  }).index("by_slug", ["slug"]),
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
    active: v.boolean(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),
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
