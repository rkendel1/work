import { NextResponse, type NextRequest } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";
import { tenantSlugFromHost } from "@/lib/tenant-routing";

type TenantRecord = {
  id: string;
  slug: string;
};

export async function middleware(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const tenantSlug = tenantSlugFromHost(host);

  if (!tenantSlug) {
    return NextResponse.next();
  }

  let tenantId: string | null = null;
  try {
    const response = await fetch(`${RUST_INGRESS_URL}/tenants`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (response.ok) {
      const tenants = (await response.json()) as TenantRecord[];
      const tenant = tenants.find((entry) => entry.slug === tenantSlug);
      tenantId = tenant?.id ?? null;
    }
  } catch {
    tenantId = null;
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

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
