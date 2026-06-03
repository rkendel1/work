import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const ingestInboxItem = mutationGeneric({
  args: {
    tenantId: v.string(),
    externalId: v.string(),
    source: v.string(),
    receivedAt: v.string(),
    content: v.string(),
    status: v.string(),
    statusUpdatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = (
      await ctx.db
      .query("inbox_items")
      .withIndex("by_tenant_external_id", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .collect()
    ).find((item) => item.externalId === args.externalId);

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("inbox_items", {
      tenantId: args.tenantId,
      externalId: args.externalId,
      source: args.source,
      receivedAt: args.receivedAt,
      content: args.content,
      status: args.status,
      statusUpdatedAt: args.statusUpdatedAt,
    });
  },
});

export const createSignalEvent = mutationGeneric({
  args: {
    tenantId: v.string(),
    sourceType: v.string(),
    rawPayload: v.any(),
    normalizedContent: v.string(),
    metadata: v.object({
      sender: v.optional(v.string()),
      timestamp: v.number(),
      channel: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("signal_events", {
      tenantId: args.tenantId,
      sourceType: args.sourceType,
      rawPayload: args.rawPayload,
      normalizedContent: args.normalizedContent,
      metadata: args.metadata,
    });
  },
});

export const createIngressEvent = mutationGeneric({
  args: {
    tenantId: v.string(),
    ingressExternalId: v.string(),
    eventType: v.string(),
    description: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const ingress = (
      await ctx.db
      .query("inbox_items")
      .withIndex("by_tenant_external_id", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .collect()
    ).find((item) => item.externalId === args.ingressExternalId);

    if (!ingress) {
      throw new Error("inbox item not found");
    }

    return await ctx.db.insert("ingress_events", {
      tenantId: args.tenantId,
      ingressId: ingress._id,
      eventType: args.eventType,
      description: args.description,
      createdAt: args.createdAt,
    });
  },
});

export const updateIngressStatus = mutationGeneric({
  args: {
    tenantId: v.string(),
    ingressExternalId: v.string(),
    status: v.string(),
    statusUpdatedAt: v.number(),
    eventType: v.string(),
    description: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const ingress = (
      await ctx.db
      .query("inbox_items")
      .withIndex("by_tenant_external_id", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .collect()
    ).find((item) => item.externalId === args.ingressExternalId);

    if (!ingress) {
      throw new Error("inbox item not found");
    }

    await ctx.db.patch(ingress._id, {
      status: args.status,
      statusUpdatedAt: args.statusUpdatedAt,
    });

    await ctx.db.insert("ingress_events", {
      tenantId: args.tenantId,
      ingressId: ingress._id,
      eventType: args.eventType,
      description: args.description,
      createdAt: args.createdAt,
    });

    return ingress._id;
  },
});

export const createWorkItem = mutationGeneric({
  args: {
    tenantId: v.string(),
    externalId: v.string(),
    inboxExternalId: v.string(),
    classificationType: v.string(),
    title: v.string(),
    summary: v.string(),
    status: v.string(),
    assignedOrgUnitExternalId: v.optional(v.string()),
    routingActionName: v.optional(v.string()),
    currentOwnerId: v.optional(v.string()),
    routingPathExternalIds: v.optional(v.array(v.string())),
    recommendedActions: v.optional(
      v.array(
        v.object({
          title: v.string(),
          description: v.string(),
          actionType: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existing = (
      await ctx.db
      .query("work_items")
      .withIndex("by_tenant_external_id", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .collect()
    ).find((item) => item.externalId === args.externalId);

    if (existing) {
      return existing._id;
    }

    const matchedAction = args.routingActionName
      ? await ctx.db
          .query("actions")
          .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.tenantId))
          .filter((query) => query.eq(query.field("name"), args.routingActionName))
          .first()
      : null;
    let assignedOrgUnitId = matchedAction?.assignedOrgUnitId;
    if (!assignedOrgUnitId) {
      const fallbackOrgUnit = await ctx.db
        .query("org_units")
        .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
        .first();
      assignedOrgUnitId =
        fallbackOrgUnit?._id ??
        (await ctx.db.insert("org_units", {
          tenantId: args.tenantId,
          name: "Operations",
          type: "department",
        }));
    }
    const routingPath = [];
    let currentId = assignedOrgUnitId;
    while (currentId) {
      routingPath.push(currentId);
      const current = await ctx.db.get(currentId);
      currentId = current?.parentId;
    }
    routingPath.reverse();

    return await ctx.db.insert("work_items", {
      tenantId: args.tenantId,
      externalId: args.externalId,
      inboxExternalId: args.inboxExternalId,
      classificationType: args.classificationType,
      title: args.title,
      summary: args.summary,
      status: args.status,
      assignedOrgUnitId,
      currentOwnerId: args.currentOwnerId,
      routingPath,
      recommendedActions: args.recommendedActions,
    });
  },
});

export const recordActionSelection = mutationGeneric({
  args: {
    tenantId: v.string(),
    workItemExternalId: v.string(),
    systemAction: v.string(),
    tenantAction: v.string(),
    selectedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workItem = (
      await ctx.db
        .query("work_items")
        .withIndex("by_tenant_external_id", (query) =>
          query.eq("tenantId", args.tenantId),
        )
        .collect()
    ).find((item) => item.externalId === args.workItemExternalId);

    if (!workItem) {
      throw new Error("work item not found");
    }

    const existingActionMapping = await ctx.db
      .query("action_mappings")
      .withIndex("by_tenant_system_action", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .filter((query) => query.eq(query.field("systemAction"), args.systemAction))
      .first();

    if (existingActionMapping) {
      await ctx.db.patch(existingActionMapping._id, {
        tenantAction: args.tenantAction,
      });
    } else {
      await ctx.db.insert("action_mappings", {
        tenantId: args.tenantId,
        systemAction: args.systemAction,
        tenantAction: args.tenantAction,
        confidence: 0.5,
      });
    }

    return await ctx.db.insert("action_selections", {
      tenantId: args.tenantId,
      workItemId: workItem._id,
      systemAction: args.systemAction,
      tenantAction: args.tenantAction,
      selectedAt: args.selectedAt ?? Date.now(),
    });
  },
});

export const recordWorkOutcome = mutationGeneric({
  args: {
    tenantId: v.string(),
    workItemExternalId: v.string(),
    selectedActionId: v.optional(v.string()),
    status: v.string(),
    resolutionNotes: v.optional(v.string()),
    feedback: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workItem = (
      await ctx.db
        .query("work_items")
        .withIndex("by_tenant_external_id", (query) =>
          query.eq("tenantId", args.tenantId),
        )
        .collect()
    ).find((item) => item.externalId === args.workItemExternalId);

    if (!workItem) {
      throw new Error("work item not found");
    }

    await ctx.db.patch(workItem._id, {
      status: args.status,
    });

    const outcomeId = await ctx.db.insert("work_outcomes", {
      tenantId: args.tenantId,
      workItemId: workItem._id,
      selectedActionId: args.selectedActionId,
      status: args.status,
      resolutionNotes: args.resolutionNotes,
      feedback: args.feedback,
      completedAt: args.completedAt ?? Date.now(),
    });

    if (args.feedback) {
      const feedbackDelta =
        args.feedback === "correct"
          ? 0.05
          : args.feedback === "partial"
            ? 0.02
            : args.feedback === "wrong"
              ? -0.05
              : -0.02;

      const classificationMapping = await ctx.db
        .query("term_mappings")
        .withIndex("by_tenant_system_term_type", (query) =>
          query.eq("tenantId", args.tenantId),
        )
        .filter((query) =>
          query.and(
            query.eq(query.field("systemTerm"), workItem.classificationType),
            query.eq(query.field("type"), "classification"),
          ),
        )
        .first();

      if (classificationMapping) {
        const existingConfidence = classificationMapping.confidence ?? 0.5;
        await ctx.db.patch(classificationMapping._id, {
          confidence: Math.max(0, Math.min(1, existingConfidence + feedbackDelta)),
        });
      }

      if (args.selectedActionId) {
        const actionMapping = await ctx.db
          .query("action_mappings")
          .withIndex("by_tenant_system_action", (query) =>
            query.eq("tenantId", args.tenantId),
          )
          .filter((query) => query.eq(query.field("systemAction"), args.selectedActionId))
          .first();

        if (actionMapping) {
          const existingConfidence = actionMapping.confidence ?? 0.5;
          await ctx.db.patch(actionMapping._id, {
            confidence: Math.max(0, Math.min(1, existingConfidence + feedbackDelta)),
          });
        } else {
          await ctx.db.insert("action_mappings", {
            tenantId: args.tenantId,
            systemAction: args.selectedActionId,
            tenantAction: args.selectedActionId,
            confidence: Math.max(0, Math.min(1, 0.5 + feedbackDelta)),
          });
        }
      }
    }

    return outcomeId;
  },
});

export const upsertBehavioralPattern = mutationGeneric({
  args: {
    tenantId: v.string(),
    patternType: v.string(),
    description: v.string(),
    evidence: v.any(),
    confidence: v.number(),
    impactScore: v.number(),
    firstObservedAt: v.number(),
    lastObservedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("behavioral_patterns")
      .withIndex("by_tenant_pattern_type", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .filter((query) => query.eq(query.field("patternType"), args.patternType))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        description: args.description,
        evidence: args.evidence,
        confidence: args.confidence,
        impactScore: args.impactScore,
        firstObservedAt: Math.min(existing.firstObservedAt, args.firstObservedAt),
        lastObservedAt: Math.max(existing.lastObservedAt, args.lastObservedAt),
      });
      return existing._id;
    }

    return await ctx.db.insert("behavioral_patterns", args);
  },
});

export const listInboxItems = queryGeneric({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("inbox_items")
      .withIndex("by_tenant_external_id", (query) => query.eq("tenantId", args.tenantId))
      .order("desc")
      .collect();
  },
});

export const listWorkItems = queryGeneric({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("work_items")
      .withIndex("by_tenant_external_id", (query) => query.eq("tenantId", args.tenantId))
      .order("desc")
      .collect();
  },
});

export const listBehavioralPatterns = queryGeneric({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("behavioral_patterns")
      .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
      .collect();
  },
});

export const getIngressTimeline = queryGeneric({
  args: {
    tenantId: v.string(),
    ingressExternalId: v.string(),
  },
  handler: async (ctx, args) => {
    const ingress = (
      await ctx.db
      .query("inbox_items")
      .withIndex("by_tenant_external_id", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .collect()
    ).find((item) => item.externalId === args.ingressExternalId);

    if (!ingress) {
      return [];
    }

    return await ctx.db
      .query("ingress_events")
      .withIndex("by_ingress_id_created_at", (query) =>
        query.eq("ingressId", ingress._id),
      )
      .order("asc")
      .collect();
  },
});
