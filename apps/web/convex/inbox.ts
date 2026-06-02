import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const ingestInboxItem = mutationGeneric({
  args: {
    externalId: v.string(),
    source: v.string(),
    receivedAt: v.string(),
    content: v.string(),
    status: v.string(),
    statusUpdatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("inbox_items")
      .withIndex("by_external_id", (query) =>
        query.eq("externalId", args.externalId),
      )
      .unique();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("inbox_items", {
      externalId: args.externalId,
      source: args.source,
      receivedAt: args.receivedAt,
      content: args.content,
      status: args.status,
      statusUpdatedAt: args.statusUpdatedAt,
    });
  },
});

export const createIngressEvent = mutationGeneric({
  args: {
    ingressExternalId: v.string(),
    eventType: v.string(),
    description: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const ingress = await ctx.db
      .query("inbox_items")
      .withIndex("by_external_id", (query) =>
        query.eq("externalId", args.ingressExternalId),
      )
      .unique();

    if (!ingress) {
      throw new Error("inbox item not found");
    }

    return await ctx.db.insert("ingress_events", {
      ingressId: ingress._id,
      eventType: args.eventType,
      description: args.description,
      createdAt: args.createdAt,
    });
  },
});

export const updateIngressStatus = mutationGeneric({
  args: {
    ingressExternalId: v.string(),
    status: v.string(),
    statusUpdatedAt: v.number(),
    eventType: v.string(),
    description: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const ingress = await ctx.db
      .query("inbox_items")
      .withIndex("by_external_id", (query) =>
        query.eq("externalId", args.ingressExternalId),
      )
      .unique();

    if (!ingress) {
      throw new Error("inbox item not found");
    }

    await ctx.db.patch(ingress._id, {
      status: args.status,
      statusUpdatedAt: args.statusUpdatedAt,
    });

    await ctx.db.insert("ingress_events", {
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
    externalId: v.string(),
    inboxExternalId: v.string(),
    title: v.string(),
    summary: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("work_items")
      .withIndex("by_external_id", (query) =>
        query.eq("externalId", args.externalId),
      )
      .unique();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("work_items", {
      externalId: args.externalId,
      inboxExternalId: args.inboxExternalId,
      title: args.title,
      summary: args.summary,
      status: args.status,
    });
  },
});

export const listInboxItems = queryGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("inbox_items").order("desc").collect();
  },
});

export const listWorkItems = queryGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("work_items").order("desc").collect();
  },
});

export const getIngressTimeline = queryGeneric({
  args: {
    ingressExternalId: v.string(),
  },
  handler: async (ctx, args) => {
    const ingress = await ctx.db
      .query("inbox_items")
      .withIndex("by_external_id", (query) =>
        query.eq("externalId", args.ingressExternalId),
      )
      .unique();

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
