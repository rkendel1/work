import { SAAS_ROOT_DOMAIN } from "@/lib/runtime-config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function normalizeHost(host: string | null | undefined): string {
  if (!host) {
    return "";
  }
  return host.toLowerCase().split(":")[0];
}

export function isRootHost(host: string | null | undefined): boolean {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) {
    return true;
  }
  if (LOCAL_HOSTS.has(normalizedHost)) {
    return true;
  }
  return (
    normalizedHost === SAAS_ROOT_DOMAIN ||
    normalizedHost === `www.${SAAS_ROOT_DOMAIN}`
  );
}

export function tenantSlugFromHost(host: string | null | undefined): string | null {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost || isRootHost(normalizedHost)) {
    return null;
  }

  if (normalizedHost.endsWith(`.${SAAS_ROOT_DOMAIN}`)) {
    const subdomain = normalizedHost.slice(0, -1 * (SAAS_ROOT_DOMAIN.length + 1));
    const slug = subdomain.startsWith("www.") ? subdomain.slice(4) : subdomain;
    return slug || null;
  }

  if (normalizedHost.endsWith(".localhost")) {
    const slug = normalizedHost.replace(".localhost", "");
    return slug || null;
  }

  return null;
}

export function tenantDomainFromSlug(slug: string): string {
  if (slug === "default") {
    return `www.${SAAS_ROOT_DOMAIN}`;
  }
  return `${slug}.${SAAS_ROOT_DOMAIN}`;
}
