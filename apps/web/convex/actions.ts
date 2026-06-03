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
    name: v.string(),
    slug: v.string(),
    domain: v.string(),
    displayName: v.string(),
    vertical: v.optional(v.string()),
    industry: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const upsertCrosswalk = async (entry: {
      tenantId: string;
      vertical: string;
      industry: string;
      systemConcept: string;
      tenantTerm: string;
      description: string;
      source: string;
      confidence: number;
    }) => {
      const existing = await ctx.db
        .query("operational_crosswalk")
        .withIndex("by_tenant_system_concept", (query) => query.eq("tenantId", entry.tenantId))
        .filter((query) => query.eq(query.field("systemConcept"), entry.systemConcept))
        .first();
      const payload = { ...entry, updatedAt: Date.now() };
      if (existing) {
        await ctx.db.patch(existing._id, payload);
        return existing._id;
      }
      return await ctx.db.insert("operational_crosswalk", payload);
    };

    const existing = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (query) => query.eq("slug", args.slug))
      .unique();
    if (existing) {
      return existing._id;
    }

    const tenantRecordId = await ctx.db.insert("tenants", args);
    const pack = loadOperationalPack(
      args.vertical ?? "General",
      args.industry ?? "General",
    );
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

      await upsertCrosswalk({
        tenantId: args.id,
        vertical: pack.vertical,
        industry: pack.industry,
        systemConcept: classification.type,
        tenantTerm: labelFromSystemTerm(classification.type),
        description: classification.description,
        source: "pack",
        confidence: 1,
      });
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

      await upsertCrosswalk({
        tenantId: args.id,
        vertical: pack.vertical,
        industry: pack.industry,
        systemConcept: action.name,
        tenantTerm: action.name,
        description: action.description,
        source: "pack",
        confidence: 1,
      });
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

export const upsertUserByEmail = mutationGeneric({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    tenantId: v.optional(v.string()),
    handle: v.optional(v.string()),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", args.email))
      .first();

    const userPatch = {
      email: args.email,
      name: args.name,
      tenantId: args.tenantId,
      handle: args.handle,
      role: args.role,
    };

    if (existing) {
      await ctx.db.patch(existing._id, userPatch);
      return existing._id;
    }

    return await ctx.db.insert("users", userPatch);
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
    const existingCrosswalk = await ctx.db
      .query("operational_crosswalk")
      .withIndex("by_tenant_system_concept", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) => query.eq(query.field("systemConcept"), args.name))
      .first();
    const crosswalkRecord = {
      tenantId: args.tenantId,
      vertical: "unknown",
      industry: "unknown",
      systemConcept: args.name,
      tenantTerm: args.name,
      description: args.description,
      source: "user_defined",
      confidence: 1,
      updatedAt: Date.now(),
    };
    if (existingCrosswalk) {
      await ctx.db.patch(existingCrosswalk._id, crosswalkRecord);
    } else {
      await ctx.db.insert("operational_crosswalk", crosswalkRecord);
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
    const upsertCrosswalk = async (entry: {
      tenantId: string;
      vertical: string;
      industry: string;
      systemConcept: string;
      tenantTerm: string;
      description: string;
      source: string;
      confidence: number;
    }) => {
      const existing = await ctx.db
        .query("operational_crosswalk")
        .withIndex("by_tenant_system_concept", (query) => query.eq("tenantId", entry.tenantId))
        .filter((query) => query.eq(query.field("systemConcept"), entry.systemConcept))
        .first();
      const payload = { ...entry, updatedAt: Date.now() };
      if (existing) {
        await ctx.db.patch(existing._id, payload);
        return existing._id;
      }
      return await ctx.db.insert("operational_crosswalk", payload);
    };

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

      await upsertCrosswalk({
        tenantId: args.tenantId,
        vertical: pack.vertical,
        industry: pack.industry,
        systemConcept: classification.type,
        tenantTerm: labelFromSystemTerm(classification.type),
        description: classification.description,
        source: "pack",
        confidence: 1,
      });
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

      await upsertCrosswalk({
        tenantId: args.tenantId,
        vertical: pack.vertical,
        industry: pack.industry,
        systemConcept: action.name,
        tenantTerm: action.name,
        description: action.description,
        source: "pack",
        confidence: 1,
      });
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
      .query("operational_crosswalk")
      .withIndex("by_tenant_system_concept", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) => query.eq(query.field("systemConcept"), args.systemTerm))
      .first();
    const record = {
      tenantId: args.tenantId,
      vertical: "unknown",
      industry: "unknown",
      systemConcept: args.systemTerm,
      tenantTerm: args.tenantTerm,
      description: `${args.type} mapping`,
      source: "user_defined",
      confidence: args.confidence ?? 0.5,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, record);
      return existing._id;
    }
    return await ctx.db.insert("operational_crosswalk", record);
  },
});

export const listTermMappings = queryGeneric({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("operational_crosswalk")
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
      .query("operational_crosswalk")
      .withIndex("by_tenant_system_concept", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) => query.eq(query.field("systemConcept"), args.systemAction))
      .first();
    const record = {
      tenantId: args.tenantId,
      vertical: "unknown",
      industry: "unknown",
      systemConcept: args.systemAction,
      tenantTerm: args.tenantAction,
      description: "action mapping",
      source: "user_defined",
      confidence: 0.5,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, record);
      return existing._id;
    }
    return await ctx.db.insert("operational_crosswalk", record);
  },
});

export const listActionMappings = queryGeneric({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("operational_crosswalk")
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
