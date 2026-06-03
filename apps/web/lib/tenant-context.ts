export function resolveTenantId(request: Request): string | undefined {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("tenantId")?.trim();
  if (fromQuery) {
    return fromQuery;
  }

  const fromHeader = request.headers.get("x-tenant-id")?.trim();
  if (fromHeader) {
    return fromHeader;
  }

  return undefined;
}
