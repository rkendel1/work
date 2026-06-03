import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

type OperationalPack = {
  vertical: string;
  industry: string;
  classifications: Array<{
    type: string;
    description: string;
  }>;
  actions: Array<{
    name: string;
    description: string;
    classificationTypes: string[];
  }>;
};

const OPERATIONAL_PACKS: OperationalPack[] = [
  {
    vertical: "Property Management",
    industry: "Commercial Real Estate",
    classifications: [
      {
        type: "maintenance_request",
        description: "Issue requiring onsite maintenance or repair.",
      },
      {
        type: "tenant_complaint",
        description: "Tenant complaint requiring operational response.",
      },
      {
        type: "lease_question",
        description: "Question related to lease terms or conditions.",
      },
      {
        type: "access_request",
        description: "Request for building or suite access.",
      },
      {
        type: "vendor_coordination",
        description: "Coordination request with external vendors.",
      },
    ],
    actions: [
      {
        name: "Inspect HVAC Unit",
        description: "Send technician to inspect HVAC equipment.",
        classificationTypes: ["maintenance_request"],
      },
      {
        name: "Dispatch Maintenance Vendor",
        description: "Coordinate approved vendor dispatch for maintenance.",
        classificationTypes: ["maintenance_request", "vendor_coordination"],
      },
      {
        name: "Respond to Tenant",
        description: "Provide tenant response and expected next steps.",
        classificationTypes: ["tenant_complaint", "lease_question"],
      },
      {
        name: "Schedule Inspection",
        description: "Schedule onsite inspection with operations staff.",
        classificationTypes: ["maintenance_request", "access_request"],
      },
      {
        name: "Create Work Order",
        description: "Open a tracked work order for follow-up.",
        classificationTypes: ["tenant_complaint"],
      },
      {
        name: "Escalate to Property Manager",
        description: "Escalate high-priority case to property management.",
        classificationTypes: ["tenant_complaint", "lease_question"],
      },
    ],
  },
  {
    vertical: "Healthcare",
    industry: "Clinic",
    classifications: [
      {
        type: "appointment_request",
        description: "Patient request for scheduling or rescheduling.",
      },
      {
        type: "patient_issue",
        description: "Patient issue requiring clinical attention.",
      },
      {
        type: "facility_issue",
        description: "Facility issue requiring operational response.",
      },
      {
        type: "billing_question",
        description: "Billing or claims related inquiry.",
      },
    ],
    actions: [
      {
        name: "Schedule Appointment",
        description: "Schedule patient appointment with available slots.",
        classificationTypes: ["appointment_request", "scheduling_request"],
      },
      {
        name: "Notify Clinical Staff",
        description: "Notify clinical team about patient issue.",
        classificationTypes: ["patient_issue"],
      },
      {
        name: "Resolve Billing Inquiry",
        description: "Resolve billing and claims inquiries.",
        classificationTypes: ["billing_question", "billing_inquiry"],
      },
      {
        name: "Escalate to Provider",
        description: "Escalate patient concern to provider.",
        classificationTypes: ["patient_issue"],
      },
    ],
  },
];

function normalizeOperationalKey(value: string) {
  return value.trim().toLowerCase();
}

function loadOperationalPack(vertical: string, industry: string): OperationalPack {
  const verticalKey = normalizeOperationalKey(vertical);
  const industryKey = normalizeOperationalKey(industry);

  const pack = OPERATIONAL_PACKS.find(
    (pack) =>
      normalizeOperationalKey(pack.vertical) === verticalKey &&
      normalizeOperationalKey(pack.industry) === industryKey,
  );
  if (pack) {
    return pack;
  }

  return {
    vertical,
    industry,
    classifications: [
      {
        type: "operational_request",
        description: "General operational request for custom workflows.",
      },
    ],
    actions: [
      {
        name: "Review Operational Signal",
        description: "Review incoming signal and choose next operational step.",
        classificationTypes: ["operational_request"],
      },
    ],
  };
}

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

    const tenantId = await ctx.db.insert("tenants", args);
    const pack = loadOperationalPack(args.vertical, args.industry);
    const existingPack = await ctx.db
      .query("operational_packs")
      .withIndex("by_vertical_industry", (query) => query.eq("vertical", pack.vertical))
      .filter((query) => query.eq(query.field("industry"), pack.industry))
      .first();
    if (!existingPack) {
      await ctx.db.insert("operational_packs", pack);
    }
    for (const classification of pack.classifications) {
      const existing = await ctx.db
        .query("tenant_classifications")
        .withIndex("by_tenant_type", (query) => query.eq("tenantId", args.id))
        .filter((query) => query.eq(query.field("type"), classification.type))
        .first();
      if (!existing) {
        await ctx.db.insert("tenant_classifications", {
          tenantId: args.id,
          type: classification.type,
          description: classification.description,
        });
      }
    }
    for (const action of pack.actions) {
      const existing = await ctx.db
        .query("actions")
        .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.id))
        .filter((query) => query.eq(query.field("name"), action.name))
        .first();
      if (!existing) {
        await ctx.db.insert("actions", {
          tenantId: args.id,
          name: action.name,
          description: action.description,
          category: "pack",
          classificationTypes: action.classificationTypes,
          active: true,
        });
      }
    }
    return tenantId;
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

    const matchingActions = actions.filter(
      (action) =>
        action.active && action.classificationTypes.includes(args.classificationType),
    );
    if (matchingActions.length > 0) {
      return matchingActions;
    }

    return [];
  },
});

export const bootstrapTenantFromPack = mutationGeneric({
  args: {
    tenantId: v.string(),
    vertical: v.string(),
    industry: v.string(),
  },
  handler: async (ctx, args) => {
    const pack = loadOperationalPack(args.vertical, args.industry);
    const existingPack = await ctx.db
      .query("operational_packs")
      .withIndex("by_vertical_industry", (query) => query.eq("vertical", pack.vertical))
      .filter((query) => query.eq(query.field("industry"), pack.industry))
      .first();
    if (!existingPack) {
      await ctx.db.insert("operational_packs", pack);
    }

    for (const classification of pack.classifications) {
      const existing = await ctx.db
        .query("tenant_classifications")
        .withIndex("by_tenant_type", (query) => query.eq("tenantId", args.tenantId))
        .filter((query) => query.eq(query.field("type"), classification.type))
        .first();
      if (!existing) {
        await ctx.db.insert("tenant_classifications", {
          tenantId: args.tenantId,
          type: classification.type,
          description: classification.description,
        });
      }
    }

    for (const action of pack.actions) {
      const existing = await ctx.db
        .query("actions")
        .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.tenantId))
        .filter((query) => query.eq(query.field("name"), action.name))
        .first();
      if (!existing) {
        await ctx.db.insert("actions", {
          tenantId: args.tenantId,
          name: action.name,
          description: action.description,
          category: "pack",
          classificationTypes: action.classificationTypes,
          active: true,
        });
      }
    }

    return pack;
  },
});
