import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import {
  isRootHost,
  normalizeTenantSlug,
  tenantSlugFromHost,
} from "@/lib/tenant-routing";

type TenantRecord = {
  id: string;
  slug: string;
};

const DEFAULT_TENANT_SLUG = "default";
const DEFAULT_TENANT_ID = "default";

async function tenantRoutingMiddleware(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const tenantSlug =
    tenantSlugFromHost(host) ?? (isRootHost(host) ? DEFAULT_TENANT_SLUG : null);

  if (!tenantSlug) {
    return NextResponse.next();
  }

  let tenantId: string | null =
    tenantSlug === DEFAULT_TENANT_SLUG ? DEFAULT_TENANT_ID : null;
  if (!tenantId) {
    try {
      const response = await fetch(`${RUST_INGRESS_URL}/tenants`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (response.ok) {
        const tenants = (await response.json()) as TenantRecord[];
        const normalizedRequestedSlug = normalizeTenantSlug(tenantSlug);
        const tenant = tenants.find(
          (entry) => normalizeTenantSlug(entry.slug) === normalizedRequestedSlug,
        );
        tenantId = tenant?.id ?? null;
      }
    } catch {
      tenantId = null;
    }
  }

  if (!tenantId && tenantSlug !== DEFAULT_TENANT_SLUG) {
    tenantId = tenantSlug;
  }

  if (!tenantId) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-id", tenantId);
  requestHeaders.set("x-tenant-slug", tenantSlug);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("x-tenant-id", tenantId);
  response.headers.set("x-tenant-slug", tenantSlug);
  return response;
}

export default clerkMiddleware(async (_auth, request) => {
  return tenantRoutingMiddleware(request);
});

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
