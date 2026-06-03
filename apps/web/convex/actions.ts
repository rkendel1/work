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
    assignedOrgUnitName: string;
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
        assignedOrgUnitName: "HVAC Team",
      },
      {
        name: "Dispatch Maintenance Vendor",
        description: "Coordinate approved vendor dispatch for maintenance.",
        classificationTypes: ["maintenance_request", "vendor_coordination"],
        assignedOrgUnitName: "Plumbing Vendor",
      },
      {
        name: "Respond to Tenant",
        description: "Provide tenant response and expected next steps.",
        classificationTypes: ["tenant_complaint", "lease_question"],
        assignedOrgUnitName: "Front Desk",
      },
      {
        name: "Schedule Inspection",
        description: "Schedule onsite inspection with operations staff.",
        classificationTypes: ["maintenance_request", "access_request"],
        assignedOrgUnitName: "Maintenance",
      },
      {
        name: "Create Work Order",
        description: "Open a tracked work order for follow-up.",
        classificationTypes: ["tenant_complaint"],
        assignedOrgUnitName: "Maintenance",
      },
      {
        name: "Escalate to Property Manager",
        description: "Escalate high-priority case to property management.",
        classificationTypes: ["tenant_complaint", "lease_question"],
        assignedOrgUnitName: "Operations",
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
        assignedOrgUnitName: "Reception",
      },
      {
        name: "Notify Clinical Staff",
        description: "Notify clinical team about patient issue.",
        classificationTypes: ["patient_issue"],
        assignedOrgUnitName: "Clinical Staff",
      },
      {
        name: "Resolve Billing Inquiry",
        description: "Resolve billing and claims inquiries.",
        classificationTypes: ["billing_question", "billing_inquiry"],
        assignedOrgUnitName: "Billing",
      },
      {
        name: "Escalate to Provider",
        description: "Escalate patient concern to provider.",
        classificationTypes: ["patient_issue"],
        assignedOrgUnitName: "Clinical Staff",
      },
    ],
  },
];

function normalizeOperationalKey(value: string) {
  return value.trim().toLowerCase();
}

function labelFromSystemTerm(systemTerm: string) {
  return systemTerm
    .split("_")
    .filter(Boolean)
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function orgUnitTemplatesForPack(pack: OperationalPack) {
  if (
    normalizeOperationalKey(pack.vertical) === "property management" &&
    normalizeOperationalKey(pack.industry) === "commercial real estate"
  ) {
    return [
      { name: "Operations", type: "department" },
      { name: "Maintenance", type: "team", parentName: "Operations" },
      { name: "HVAC Team", type: "team", parentName: "Maintenance" },
      { name: "Plumbing Vendor", type: "vendor", parentName: "Maintenance" },
      { name: "Leasing", type: "team", parentName: "Operations" },
      { name: "Front Desk", type: "team", parentName: "Operations" },
    ];
  }

  if (
    normalizeOperationalKey(pack.vertical) === "healthcare" &&
    normalizeOperationalKey(pack.industry) === "clinic"
  ) {
    return [
      { name: "Clinic Operations", type: "department" },
      { name: "Reception", type: "team", parentName: "Clinic Operations" },
      { name: "Clinical Staff", type: "team", parentName: "Clinic Operations" },
      { name: "Billing", type: "team", parentName: "Clinic Operations" },
      { name: "Compliance", type: "team", parentName: "Clinic Operations" },
    ];
  }

  return [
    { name: "Operations", type: "department" },
    { name: "General Team", type: "team", parentName: "Operations" },
  ];
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
        assignedOrgUnitName: "Operations",
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

    const tenantRecordId = await ctx.db.insert("tenants", args);
    const pack = loadOperationalPack(args.vertical, args.industry);
    const orgUnitIdsByName = new Map<string, string>();
    for (const template of orgUnitTemplatesForPack(pack)) {
      const existing = await ctx.db
        .query("org_units")
        .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.id))
        .filter((query) => query.eq(query.field("name"), template.name))
        .first();
      if (existing) {
        orgUnitIdsByName.set(template.name, existing._id);
        continue;
      }
      const parentId = template.parentName ? orgUnitIdsByName.get(template.parentName) : undefined;
      const unitId = await ctx.db.insert("org_units", {
        tenantId: args.id,
        name: template.name,
        type: template.type,
        parentId,
      });
      orgUnitIdsByName.set(template.name, unitId);
    }
    const fallbackOrgUnitId = orgUnitIdsByName.values().next().value;
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

      const existingTermMapping = await ctx.db
        .query("term_mappings")
        .withIndex("by_tenant_system_term_type", (query) =>
          query.eq("tenantId", args.id),
        )
        .filter((query) => query.eq(query.field("systemTerm"), classification.type))
        .filter((query) => query.eq(query.field("type"), "classification"))
        .first();
      if (!existingTermMapping) {
        await ctx.db.insert("term_mappings", {
          tenantId: args.id,
          systemTerm: classification.type,
          tenantTerm: labelFromSystemTerm(classification.type),
          type: "classification",
          confidence: 1,
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
        const assignedOrgUnitId =
          orgUnitIdsByName.get(action.assignedOrgUnitName) ?? fallbackOrgUnitId;
        if (!assignedOrgUnitId) {
          continue;
        }
        await ctx.db.insert("actions", {
          tenantId: args.id,
          name: action.name,
          description: action.description,
          category: "pack",
          classificationTypes: action.classificationTypes,
          assignedOrgUnitId,
          active: true,
        });
      }

      const existingActionMapping = await ctx.db
        .query("action_mappings")
        .withIndex("by_tenant_system_action", (query) =>
          query.eq("tenantId", args.id),
        )
        .filter((query) => query.eq(query.field("systemAction"), action.name))
        .first();
      if (!existingActionMapping) {
        await ctx.db.insert("action_mappings", {
          tenantId: args.id,
          systemAction: action.name,
          tenantAction: action.name,
        });
      }
    }
    return tenantRecordId;
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
    assignedOrgUnitId: v.id("org_units"),
    defaultOwnerRole: v.optional(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actionId = await ctx.db.insert("actions", args);
    const existingActionMapping = await ctx.db
      .query("action_mappings")
      .withIndex("by_tenant_system_action", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .filter((query) => query.eq(query.field("systemAction"), args.name))
      .first();
    if (!existingActionMapping) {
      await ctx.db.insert("action_mappings", {
        tenantId: args.tenantId,
        systemAction: args.name,
        tenantAction: args.name,
      });
    }
    return actionId;
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
    const orgUnitIdsByName = new Map<string, string>();
    for (const template of orgUnitTemplatesForPack(pack)) {
      const existing = await ctx.db
        .query("org_units")
        .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.tenantId))
        .filter((query) => query.eq(query.field("name"), template.name))
        .first();
      if (existing) {
        orgUnitIdsByName.set(template.name, existing._id);
        continue;
      }
      const parentId = template.parentName ? orgUnitIdsByName.get(template.parentName) : undefined;
      const unitId = await ctx.db.insert("org_units", {
        tenantId: args.tenantId,
        name: template.name,
        type: template.type,
        parentId,
      });
      orgUnitIdsByName.set(template.name, unitId);
    }
    const fallbackOrgUnitId = orgUnitIdsByName.values().next().value;
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

      const existingTermMapping = await ctx.db
        .query("term_mappings")
        .withIndex("by_tenant_system_term_type", (query) => query.eq("tenantId", args.tenantId))
        .filter((query) => query.eq(query.field("systemTerm"), classification.type))
        .filter((query) => query.eq(query.field("type"), "classification"))
        .first();
      if (!existingTermMapping) {
        await ctx.db.insert("term_mappings", {
          tenantId: args.tenantId,
          systemTerm: classification.type,
          tenantTerm: labelFromSystemTerm(classification.type),
          type: "classification",
          confidence: 1,
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
        const assignedOrgUnitId =
          orgUnitIdsByName.get(action.assignedOrgUnitName) ?? fallbackOrgUnitId;
        if (!assignedOrgUnitId) {
          continue;
        }
        await ctx.db.insert("actions", {
          tenantId: args.tenantId,
          name: action.name,
          description: action.description,
          category: "pack",
          classificationTypes: action.classificationTypes,
          assignedOrgUnitId,
          active: true,
        });
      }

      const existingActionMapping = await ctx.db
        .query("action_mappings")
        .withIndex("by_tenant_system_action", (query) =>
          query.eq("tenantId", args.tenantId),
        )
        .filter((query) => query.eq(query.field("systemAction"), action.name))
        .first();
      if (!existingActionMapping) {
        await ctx.db.insert("action_mappings", {
          tenantId: args.tenantId,
          systemAction: action.name,
          tenantAction: action.name,
        });
      }
    }

    return pack;
  },
});

export const upsertTermMapping = mutationGeneric({
  args: {
    tenantId: v.string(),
    systemTerm: v.string(),
    tenantTerm: v.string(),
    type: v.string(),
    confidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("term_mappings")
      .withIndex("by_tenant_system_term_type", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .filter((query) => query.eq(query.field("systemTerm"), args.systemTerm))
      .filter((query) => query.eq(query.field("type"), args.type))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        tenantTerm: args.tenantTerm,
        confidence: args.confidence,
      });
      return existing._id;
    }

    return await ctx.db.insert("term_mappings", args);
  },
});

export const listTermMappings = queryGeneric({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("term_mappings")
      .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
      .collect();
  },
});

export const upsertActionMapping = mutationGeneric({
  args: {
    tenantId: v.string(),
    systemAction: v.string(),
    tenantAction: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("action_mappings")
      .withIndex("by_tenant_system_action", (query) =>
        query.eq("tenantId", args.tenantId),
      )
      .filter((query) => query.eq(query.field("systemAction"), args.systemAction))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        tenantAction: args.tenantAction,
      });
      return existing._id;
    }

    return await ctx.db.insert("action_mappings", args);
  },
});

export const listActionMappings = queryGeneric({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("action_mappings")
      .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
      .collect();
  },
});

export const createRole = mutationGeneric({
  args: {
    tenantId: v.string(),
    name: v.string(),
    permissions: v.array(v.string()),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) => query.eq(query.field("name"), args.name))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        permissions: args.permissions,
        scopes: args.scopes,
      });
      return existing._id;
    }
    return await ctx.db.insert("roles", args);
  },
});

export const listRoles = queryGeneric({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("roles")
      .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
      .collect();
  },
});

export const upsertUserAccountability = mutationGeneric({
  args: {
    tenantId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    handle: v.string(),
    role: v.string(),
    orgUnitId: v.optional(v.id("org_units")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", args.email))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        tenantId: args.tenantId,
        name: args.name,
        handle: args.handle,
        role: args.role,
        orgUnitId: args.orgUnitId,
      });
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tenantId: args.tenantId,
      email: args.email,
      name: args.name,
      handle: args.handle,
      role: args.role,
      orgUnitId: args.orgUnitId,
    });
  },
});
