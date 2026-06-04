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
    const tenants = await ctx.db.query("tenants").collect();
    return tenants.sort((left, right) => left.displayName.localeCompare(right.displayName));
  },
});

export const updateTenantProfile = mutationGeneric({
  args: {
    tenantId: v.string(),
    displayName: v.optional(v.string()),
    domain: v.optional(v.string()),
    vertical: v.optional(v.string()),
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await ctx.db
      .query("tenants")
      .filter((query) => query.eq(query.field("id"), args.tenantId))
      .first();
    if (!tenant) {
      throw new Error("tenant not found");
    }

    const nextDisplayName = args.displayName?.trim() || tenant.displayName;
    const nextVertical = args.vertical?.trim() || tenant.vertical;
    const nextIndustry = args.industry?.trim() || tenant.industry;
    const nextDomain = args.domain?.trim() || tenant.domain;

    await ctx.db.patch(tenant._id, {
      displayName: nextDisplayName,
      name: nextDisplayName,
      domain: nextDomain,
      vertical: nextVertical,
      industry: nextIndustry,
    });

    if (nextVertical) {
      const existingVertical = await ctx.db
        .query("verticals")
        .withIndex("by_name", (query) => query.eq("name", nextVertical))
        .first();
      if (!existingVertical) {
        await ctx.db.insert("verticals", { name: nextVertical });
      }
    }

    if (nextVertical && nextIndustry) {
      const existingIndustry = await ctx.db
        .query("industries")
        .withIndex("by_vertical_name", (query) => query.eq("vertical", nextVertical))
        .filter((query) => query.eq(query.field("name"), nextIndustry))
        .first();
      if (!existingIndustry) {
        await ctx.db.insert("industries", {
          vertical: nextVertical,
          name: nextIndustry,
        });
      }
    }

    return tenant._id;
  },
});

export const listVerticals = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const verticals = await ctx.db.query("verticals").collect();
    return verticals.sort((left, right) => left.name.localeCompare(right.name));
  },
});

export const upsertVertical = mutationGeneric({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) {
      throw new Error("name is required");
    }

    const existing = await ctx.db
      .query("verticals")
      .withIndex("by_name", (query) => query.eq("name", name))
      .first();
    if (existing) {
      return existing._id;
    }
    return await ctx.db.insert("verticals", { name });
  },
});

export const listIndustries = queryGeneric({
  args: {
    vertical: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const vertical = args.vertical?.trim();
    const industries = vertical
      ? await ctx.db
          .query("industries")
          .withIndex("by_vertical_name", (query) => query.eq("vertical", vertical))
          .collect()
      : await ctx.db.query("industries").collect();
    return industries.sort((left, right) => {
      const leftKey = `${left.vertical}::${left.name}`;
      const rightKey = `${right.vertical}::${right.name}`;
      return leftKey.localeCompare(rightKey);
    });
  },
});

export const upsertIndustry = mutationGeneric({
  args: {
    vertical: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const vertical = args.vertical.trim();
    const name = args.name.trim();
    if (!vertical || !name) {
      throw new Error("vertical and name are required");
    }

    const existingVertical = await ctx.db
      .query("verticals")
      .withIndex("by_name", (query) => query.eq("name", vertical))
      .first();
    if (!existingVertical) {
      await ctx.db.insert("verticals", { name: vertical });
    }

    const existing = await ctx.db
      .query("industries")
      .withIndex("by_vertical_name", (query) => query.eq("vertical", vertical))
      .filter((query) => query.eq(query.field("name"), name))
      .first();
    if (existing) {
      return existing._id;
    }
    return await ctx.db.insert("industries", { vertical, name });
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

export const seedTenantDataset = mutationGeneric({
  args: {
    tenantId: v.string(),
    userEmail: v.string(),
    userName: v.optional(v.string()),
    userHandle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tenant = (await ctx.db.query("tenants").collect()).find((entry) => entry.id === args.tenantId);
    if (!tenant) {
      throw new Error("tenant not found");
    }

    if (tenant.vertical) {
      const vertical = await ctx.db
        .query("verticals")
        .withIndex("by_name", (query) => query.eq("name", tenant.vertical))
        .first();
      if (!vertical) {
        await ctx.db.insert("verticals", { name: tenant.vertical });
      }
    }

    if (tenant.vertical && tenant.industry) {
      const industry = await ctx.db
        .query("industries")
        .withIndex("by_vertical_name", (query) => query.eq("vertical", tenant.vertical))
        .filter((query) => query.eq(query.field("name"), tenant.industry))
        .first();
      if (!industry) {
        await ctx.db.insert("industries", {
          vertical: tenant.vertical,
          name: tenant.industry,
        });
      }
    }

    const tenantClassifications = await ctx.db
      .query("tenant_classifications")
      .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
      .collect();
    const classificationType = tenantClassifications[0]?.type ?? "operational_request";
    const coreClassification = await ctx.db
      .query("core_classifications")
      .withIndex("by_key", (query) => query.eq("key", classificationType))
      .first();
    if (!coreClassification) {
      await ctx.db.insert("core_classifications", {
        key: classificationType,
        label: labelFromSystemTerm(classificationType),
      });
    }

    const orgUnits = await ctx.db
      .query("org_units")
      .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
      .collect();
    const primaryOrgUnit =
      orgUnits[0] ??
      ({
        _id: await ctx.db.insert("org_units", {
          tenantId: args.tenantId,
          name: "Operations",
          type: "department",
        }),
      } as { _id: string });

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", args.userEmail))
      .first();
    const userId = existingUser
      ? existingUser._id
      : await ctx.db.insert("users", {
          tenantId: args.tenantId,
          email: args.userEmail,
          name: args.userName ?? "Seeded Operator",
          handle: args.userHandle ?? `seed-${args.tenantId}`,
          role: "admin",
          orgUnitId: primaryOrgUnit._id,
        });
    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        tenantId: args.tenantId,
        name: args.userName ?? existingUser.name,
        handle: args.userHandle ?? existingUser.handle ?? `seed-${args.tenantId}`,
        role: "admin",
        orgUnitId: primaryOrgUnit._id,
      });
    }

    const role = await ctx.db
      .query("roles")
      .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) => query.eq(query.field("name"), "admin"))
      .first();
    const rolePermissions = ["ingress:view", "work:manage", "settings:manage"];
    const roleScopes = ["tenant:*"];
    if (role) {
      await ctx.db.patch(role._id, {
        permissions: rolePermissions,
        scopes: roleScopes,
      });
    } else {
      await ctx.db.insert("roles", {
        tenantId: args.tenantId,
        name: "admin",
        permissions: rolePermissions,
        scopes: roleScopes,
      });
    }

    const businessRule = await ctx.db
      .query("business_rules")
      .withIndex("by_tenant_scope", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) => query.eq(query.field("scope"), "tenant"))
      .filter((query) => query.eq(query.field("title"), "Seeded urgent routing"))
      .first();
    if (!businessRule) {
      await ctx.db.insert("business_rules", {
        tenantId: args.tenantId,
        orgUnitId: primaryOrgUnit._id,
        title: "Seeded urgent routing",
        ruleText: "If signal contains urgency marker, route to Operations immediately.",
        scope: "tenant",
        active: true,
        priority: 100,
      });
    }

    const ingressExternalId = `seed-${args.tenantId}-inbox-001`;
    const workExternalId = `seed-${args.tenantId}-work-001`;
    let inboxItem = (
      await ctx.db
        .query("inbox_items")
        .withIndex("by_tenant_external_id", (query) => query.eq("tenantId", args.tenantId))
        .collect()
    ).find((item) => item.externalId === ingressExternalId);
    if (!inboxItem) {
      const inboxId = await ctx.db.insert("inbox_items", {
        tenantId: args.tenantId,
        externalId: ingressExternalId,
        source: "github_seed",
        receivedAt: new Date(now).toISOString(),
        content: `Seeded inbound request for tenant ${args.tenantId}`,
        status: "work_generated",
        statusUpdatedAt: now,
      });
      inboxItem = await ctx.db.get(inboxId);
    }
    if (!inboxItem) {
      throw new Error("failed to seed inbox item");
    }

    const signalEvent = (await ctx.db.query("signal_events").collect()).find(
      (event) =>
        event.tenantId === args.tenantId &&
        event.sourceType === "github_seed" &&
        event.rawPayload?.externalId === ingressExternalId,
    );
    if (!signalEvent) {
      await ctx.db.insert("signal_events", {
        tenantId: args.tenantId,
        sourceType: "github_seed",
        provenance: {
          origin: "github",
          generatedBy: "seedGithubSignal",
        },
        rawPayload: {
          externalId: ingressExternalId,
          repository: "rkendel1/work",
        },
        normalizedContent: `Seeded signal for ${ingressExternalId}`,
        metadata: {
          sender: "github-script",
          timestamp: now,
          channel: "github",
        },
      });
    }

    const ingressEvent = await ctx.db
      .query("ingress_events")
      .withIndex("by_ingress_id_created_at", (query) => query.eq("ingressId", inboxItem._id))
      .filter((query) => query.eq(query.field("eventType"), "seeded"))
      .first();
    if (!ingressEvent) {
      await ctx.db.insert("ingress_events", {
        tenantId: args.tenantId,
        ingressId: inboxItem._id,
        eventType: "seeded",
        description: "Inbound seeded from GitHub script.",
        createdAt: now,
      });
    }

    const actions = await ctx.db
      .query("actions")
      .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
      .collect();
    const selectedAction = actions[0];
    const selectedActionName = selectedAction?.name ?? "Review Operational Signal";

    let workItem = (
      await ctx.db
        .query("work_items")
        .withIndex("by_tenant_external_id", (query) => query.eq("tenantId", args.tenantId))
        .collect()
    ).find((item) => item.externalId === workExternalId);
    if (!workItem) {
      const workItemId = await ctx.db.insert("work_items", {
        tenantId: args.tenantId,
        externalId: workExternalId,
        inboxExternalId: ingressExternalId,
        classificationType,
        title: `Seeded work for ${args.tenantId}`,
        summary: "Generated for full-schema early capability validation.",
        status: "resolved",
        assignedOrgUnitId: primaryOrgUnit._id,
        currentOwnerId: userId,
        routingPath: [primaryOrgUnit._id],
        recommendedActions: [
          {
            title: selectedActionName,
            description: "Seeded recommendation",
            actionType: "seed",
          },
        ],
      });
      workItem = await ctx.db.get(workItemId);
    }
    if (!workItem) {
      throw new Error("failed to seed work item");
    }

    const workMeaning = await ctx.db
      .query("operational_meanings")
      .withIndex("by_tenant_entity", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) =>
        query.and(
          query.eq(query.field("entityType"), "work_item"),
          query.eq(query.field("entityId"), workExternalId),
        ),
      )
      .first();
    if (workMeaning) {
      await ctx.db.patch(workMeaning._id, {
        systemConcept: classificationType,
        inferredMeaning: "Seeded operational meaning for validation.",
        state: "confirmed",
        confidence: 0.9,
        evidence: ["seed:github", `tenant:${args.tenantId}`],
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("operational_meanings", {
        tenantId: args.tenantId,
        entityType: "work_item",
        entityId: workExternalId,
        systemConcept: classificationType,
        inferredMeaning: "Seeded operational meaning for validation.",
        state: "confirmed",
        confidence: 0.9,
        evidence: ["seed:github", `tenant:${args.tenantId}`],
        updatedAt: now,
      });
    }

    const actionSelection = await ctx.db
      .query("action_selections")
      .withIndex("by_work_item_selected_at", (query) => query.eq("workItemId", workItem._id))
      .filter((query) => query.eq(query.field("systemAction"), selectedActionName))
      .first();
    if (!actionSelection) {
      await ctx.db.insert("action_selections", {
        tenantId: args.tenantId,
        workItemId: workItem._id,
        systemAction: selectedActionName,
        tenantAction: selectedActionName,
        selectedAt: now,
      });
    }

    const workOutcome = await ctx.db
      .query("work_outcomes")
      .withIndex("by_work_item_completed_at", (query) => query.eq("workItemId", workItem._id))
      .first();
    if (!workOutcome) {
      await ctx.db.insert("work_outcomes", {
        tenantId: args.tenantId,
        workItemId: workItem._id,
        selectedActionId: selectedActionName,
        status: "resolved",
        resolutionNotes: "Seeded outcome",
        feedback: "correct",
        completedAt: now,
      });
    }

    const execution = await ctx.db
      .query("execution_results")
      .withIndex("by_work_item_timestamp", (query) => query.eq("workItemId", workItem._id))
      .filter((query) => query.eq(query.field("executionType"), "seed"))
      .first();
    if (!execution) {
      await ctx.db.insert("execution_results", {
        tenantId: args.tenantId,
        workItemId: workItem._id,
        executedBy: "github-seed-script",
        executionType: "seed",
        status: "success",
        resultType: "simulation",
        summary: "Seeded execution result for early capability testing.",
        payload: {
          source: "github_seed",
          tenantId: args.tenantId,
        },
        sideEffects: [
          {
            type: "notification",
            targetSystem: "convex",
            targetId: workExternalId,
            description: "Seed inserted execution result",
          },
        ],
        contextSnapshot: {
          workExternalId,
          ingressExternalId,
        },
        timestamp: now,
      });
    }

    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_tenant_entity", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) =>
        query.and(
          query.eq(query.field("entityType"), "work_item"),
          query.eq(query.field("entityId"), workExternalId),
          query.eq(query.field("userId"), userId),
        ),
      )
      .first();
    if (!assignment) {
      await ctx.db.insert("assignments", {
        tenantId: args.tenantId,
        entityType: "work_item",
        entityId: workExternalId,
        userId,
        responsibilityType: "owner",
        createdAt: now,
      });
    }

    const message = await ctx.db
      .query("messages")
      .withIndex("by_tenant_target_created_at", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) =>
        query.and(
          query.eq(query.field("targetType"), "work_item"),
          query.eq(query.field("targetId"), workExternalId),
        ),
      )
      .filter((query) => query.eq(query.field("type"), "note"))
      .first();
    if (!message) {
      await ctx.db.insert("messages", {
        tenantId: args.tenantId,
        authorUserId: userId,
        targetType: "work_item",
        targetId: workExternalId,
        type: "note",
        content: "Seeded collaborator note.",
        createdAt: now,
      });
    }

    const notification = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_user_read", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) =>
        query.and(
          query.eq(query.field("userId"), userId),
          query.eq(query.field("read"), false),
        ),
      )
      .first();
    if (!notification) {
      await ctx.db.insert("notifications", {
        tenantId: args.tenantId,
        userId,
        triggerType: "seed_completed",
        entityType: "work_item",
        entityId: workExternalId,
        read: false,
        createdAt: now,
      });
    }

    const workState = await ctx.db
      .query("work_states")
      .withIndex("by_work_item_timestamp", (query) => query.eq("workItemId", workItem._id))
      .filter((query) => query.eq(query.field("state"), "resolved"))
      .first();
    if (!workState) {
      await ctx.db.insert("work_states", {
        tenantId: args.tenantId,
        workItemId: workItem._id,
        state: "resolved",
        transitionedBy: "seed-script",
        reason: "seeded data initialization",
        timestamp: now,
      });
    }

    const tenantSecret = await ctx.db
      .query("tenant_secrets")
      .withIndex("by_tenant_provider", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) => query.eq(query.field("provider"), "github"))
      .filter((query) => query.eq(query.field("keyName"), "seed_token"))
      .first();
    if (!tenantSecret) {
      await ctx.db.insert("tenant_secrets", {
        tenantId: args.tenantId,
        keyName: "seed_token",
        encryptedValue: "seeded-placeholder-token",
        provider: "github",
        createdAt: now,
      });
    }

    const behavioralPattern = await ctx.db
      .query("behavioral_patterns")
      .withIndex("by_tenant_pattern_type", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) => query.eq(query.field("patternType"), "seeded_operational_signal"))
      .first();
    if (behavioralPattern) {
      await ctx.db.patch(behavioralPattern._id, {
        description: "Seeded pattern showing repeated operational signal handling.",
        evidence: { source: "github_seed", workExternalId },
        confidence: 0.88,
        impactScore: 0.72,
        firstObservedAt: Math.min(behavioralPattern.firstObservedAt, now),
        lastObservedAt: Math.max(behavioralPattern.lastObservedAt, now),
      });
    } else {
      await ctx.db.insert("behavioral_patterns", {
        tenantId: args.tenantId,
        patternType: "seeded_operational_signal",
        description: "Seeded pattern showing repeated operational signal handling.",
        evidence: { source: "github_seed", workExternalId },
        confidence: 0.88,
        impactScore: 0.72,
        firstObservedAt: now,
        lastObservedAt: now,
      });
    }

    const ingestNode = await ctx.db
      .query("process_nodes")
      .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) =>
        query.and(
          query.eq(query.field("name"), "Signal Intake"),
          query.eq(query.field("type"), "ingest"),
        ),
      )
      .first();
    const ingestNodeId =
      ingestNode?._id ??
      (await ctx.db.insert("process_nodes", {
        tenantId: args.tenantId,
        orgUnitId: primaryOrgUnit._id,
        name: "Signal Intake",
        type: "ingest",
        source: "github_seed",
        confidence: 0.9,
        firstSeenAt: now,
        lastSeenAt: now,
      }));

    const executionNode = await ctx.db
      .query("process_nodes")
      .withIndex("by_tenant_name", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) =>
        query.and(
          query.eq(query.field("name"), "Work Execution"),
          query.eq(query.field("type"), "execution"),
        ),
      )
      .first();
    const executionNodeId =
      executionNode?._id ??
      (await ctx.db.insert("process_nodes", {
        tenantId: args.tenantId,
        orgUnitId: primaryOrgUnit._id,
        name: "Work Execution",
        type: "execution",
        source: "github_seed",
        confidence: 0.9,
        firstSeenAt: now,
        lastSeenAt: now,
      }));

    const processEdge = await ctx.db
      .query("process_edges")
      .withIndex("by_tenant", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) =>
        query.and(
          query.eq(query.field("fromNodeId"), ingestNodeId),
          query.eq(query.field("toNodeId"), executionNodeId),
          query.eq(query.field("transitionType"), "seed_flow"),
        ),
      )
      .first();
    if (processEdge) {
      await ctx.db.patch(processEdge._id, {
        frequency: Math.max(processEdge.frequency, 1),
        confidence: Math.max(processEdge.confidence, 0.85),
      });
    } else {
      await ctx.db.insert("process_edges", {
        tenantId: args.tenantId,
        fromNodeId: ingestNodeId,
        toNodeId: executionNodeId,
        transitionType: "seed_flow",
        frequency: 1,
        confidence: 0.85,
      });
    }

    const artifact = await ctx.db
      .query("operational_artifacts")
      .withIndex("by_tenant_type", (query) => query.eq("tenantId", args.tenantId))
      .filter((query) => query.eq(query.field("type"), "seed_summary"))
      .filter((query) => query.eq(query.field("name"), "Initial Capability Seed"))
      .first();
    const artifactPayload = {
      tenantId: args.tenantId,
      name: "Initial Capability Seed",
      type: "seed_summary",
      orgUnitId: primaryOrgUnit._id,
      source: "github_seed",
      version: 1,
      content: {
        ingressExternalId,
        workExternalId,
        seededAt: now,
      },
      derivedFrom: ["signal_events", "work_items", "execution_results"],
      lastUpdatedAt: now,
    };
    if (artifact) {
      await ctx.db.patch(artifact._id, artifactPayload);
    } else {
      await ctx.db.insert("operational_artifacts", artifactPayload);
    }

    return {
      tenantId: args.tenantId,
      seededUserId: userId,
      seededWorkExternalId: workExternalId,
      seededIngressExternalId: ingressExternalId,
    };
  },
});
