import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const createTenant = mutationGeneric({
  args: {
    id: v.string(),
    slug: v.string(),
    displayName: v.string(),
    vertical: v.string(),
    industry: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (query) => query.eq("slug", args.slug))
      .unique();
    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("tenants", args);
  },
});

export const listTenants = queryGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tenants").collect();
  },
});

export const createAction = mutationGeneric({
  args: {
    tenantId: v.string(),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    classificationTypes: v.array(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("actions", args);
  },
});

export const listTenantActions = queryGeneric({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("actions")
      .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.tenantId))
      .collect();
  },
});

export const listMatchingActions = queryGeneric({
  args: {
    tenantId: v.string(),
    classificationType: v.string(),
  },
  handler: async (ctx, args) => {
    const actions = await ctx.db
      .query("actions")
      .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
      .collect();

    return actions.filter(
      (action) =>
        action.active && action.classificationTypes.includes(args.classificationType),
    );
  },
});
