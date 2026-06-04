import { NextResponse } from "next/server";
import { runConvexAdminMutation, runConvexAdminQuery } from "@/lib/convex-admin";
import { normalizeTenantSlug, tenantDomainFromSlug } from "@/lib/tenant-routing";

type TenantRecord = {
  id: string;
  slug: string;
  name: string;
  displayName?: string;
  domain: string;
  vertical?: string;
  industry?: string;
  createdAt?: number;
};

type VerticalRecord = {
  name: string;
};

type IndustryRecord = {
  vertical: string;
  name: string;
};

type DemoAdminPayload =
  | {
      action: "createTenant";
      name?: string;
      slug?: string;
      vertical?: string;
      industry?: string;
      domain?: string;
    }
  | {
      action: "updateTenant";
      tenantId?: string;
      displayName?: string;
      vertical?: string;
      industry?: string;
      domain?: string;
    }
  | {
      action: "addVertical";
      name?: string;
    }
  | {
      action: "addIndustry";
      vertical?: string;
      name?: string;
    }
  | {
      action: "seedTenant";
      tenantId?: string;
      userEmail?: string;
      userName?: string;
      userHandle?: string;
    };

function requestHost(request: Request): string {
  return (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host
  );
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readCatalog() {
  const [tenants, verticals, industries] = await Promise.all([
    runConvexAdminQuery<TenantRecord[]>("actions:listTenants", {}),
    runConvexAdminQuery<VerticalRecord[]>("actions:listVerticals", {}),
    runConvexAdminQuery<IndustryRecord[]>("actions:listIndustries", {}),
  ]);

  return {
    tenants: Array.isArray(tenants) ? tenants : [],
    verticals: Array.isArray(verticals) ? verticals : [],
    industries: Array.isArray(industries) ? industries : [],
  };
}

export async function GET() {
  try {
    const catalog = await readCatalog();
    return NextResponse.json(catalog, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load demo admin catalog" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let payload: DemoAdminPayload;
  try {
    payload = (await request.json()) as DemoAdminPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    if (payload.action === "createTenant") {
      const name = asTrimmedString(payload.name);
      if (!name) {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      const slug = normalizeTenantSlug(asTrimmedString(payload.slug) ?? name) || "default";
      const host = requestHost(request);
      const domain = asTrimmedString(payload.domain) ?? tenantDomainFromSlug(slug, host);
      const vertical = asTrimmedString(payload.vertical) ?? "General";
      const industry = asTrimmedString(payload.industry) ?? "General";
      const createdAt = Math.floor(Date.now() / 1000);
      await runConvexAdminMutation("actions:createTenant", {
        id: slug,
        name,
        slug,
        domain,
        displayName: name,
        vertical,
        industry,
        createdAt,
      });
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    if (payload.action === "updateTenant") {
      const tenantId = asTrimmedString(payload.tenantId);
      if (!tenantId) {
        return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
      }
      await runConvexAdminMutation("actions:updateTenantProfile", {
        tenantId,
        displayName: asTrimmedString(payload.displayName) ?? undefined,
        vertical: asTrimmedString(payload.vertical) ?? undefined,
        industry: asTrimmedString(payload.industry) ?? undefined,
        domain: asTrimmedString(payload.domain) ?? undefined,
      });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (payload.action === "addVertical") {
      const name = asTrimmedString(payload.name);
      if (!name) {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      await runConvexAdminMutation("actions:upsertVertical", { name });
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    if (payload.action === "addIndustry") {
      const vertical = asTrimmedString(payload.vertical);
      const name = asTrimmedString(payload.name);
      if (!vertical || !name) {
        return NextResponse.json({ error: "vertical and name are required" }, { status: 400 });
      }
      await runConvexAdminMutation("actions:upsertIndustry", {
        vertical,
        name,
      });
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    if (payload.action === "seedTenant") {
      const tenantId = asTrimmedString(payload.tenantId);
      if (!tenantId) {
        return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
      }
      const fallbackEmail = `demo.operator+${tenantId}@canonflo.local`;
      await runConvexAdminMutation("actions:seedTenantDataset", {
        tenantId,
        userEmail: asTrimmedString(payload.userEmail) ?? fallbackEmail,
        userName: asTrimmedString(payload.userName) ?? "Demo Operator",
        userHandle: asTrimmedString(payload.userHandle) ?? `demo-${tenantId}`,
      });
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Demo admin operation failed" },
      { status: 500 },
    );
  }
}
