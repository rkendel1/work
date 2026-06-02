import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  inbox_items: defineTable({
    externalId: v.string(),
    source: v.string(),
    receivedAt: v.string(),
    content: v.string(),
    status: v.string(),
    statusUpdatedAt: v.number(),
  }).index("by_external_id", ["externalId"]),
  ingress_events: defineTable({
    ingressId: v.id("inbox_items"),
    eventType: v.string(),
    description: v.string(),
    createdAt: v.number(),
  }).index("by_ingress_id_created_at", ["ingressId", "createdAt"]),
  work_items: defineTable({
    externalId: v.string(),
    inboxExternalId: v.string(),
    title: v.string(),
    summary: v.string(),
    status: v.string(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_inbox_external_id", ["inboxExternalId"]),
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
  }).index("by_email", ["email"]),
  tenants: defineTable({
    slug: v.string(),
    displayName: v.string(),
  }).index("by_slug", ["slug"]),
});
