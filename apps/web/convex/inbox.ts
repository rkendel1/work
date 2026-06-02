import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const ingestInboxItem = mutationGeneric({
  args: {
    externalId: v.string(),
    source: v.string(),
    receivedAt: v.string(),
    content: v.string(),
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
    });
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
