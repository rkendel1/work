import { SAAS_ROOT_DOMAIN } from "@/lib/runtime-config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function normalizeHost(host: string | null | undefined): string {
  if (!host) {
    return "";
  }
  return host.toLowerCase().split(":")[0];
}

export function normalizeTenantSlug(slug: string | null | undefined): string {
  const input = (slug ?? "").toLowerCase().trim();
  let normalized = "";
  let previousWasSeparator = false;

  for (const character of input) {
    const code = character.charCodeAt(0);
    const isAlphaNumeric =
      (code >= 97 && code <= 122) || // a-z
      (code >= 48 && code <= 57); // 0-9

    if (isAlphaNumeric) {
      normalized += character;
      previousWasSeparator = false;
      continue;
    }

    if (!previousWasSeparator && normalized.length > 0) {
      normalized += "-";
      previousWasSeparator = true;
    }
  }

  if (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
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
    const firstLabel = subdomain.split(".")[0];
    const slug = firstLabel.startsWith("www.") ? firstLabel.slice(4) : firstLabel;
    return slug || null;
  }

  if (normalizedHost.endsWith(".localhost")) {
    const slug = normalizedHost.replace(".localhost", "");
    return slug || null;
  }

  return null;
}

export function tenantDomainFromSlug(
  slug: string,
  currentHost?: string | null | undefined,
): string {
  const normalizedHost = normalizeHost(currentHost);
  const normalizedSlug = normalizeTenantSlug(slug) || "default";
  if (
    normalizedHost &&
    (LOCAL_HOSTS.has(normalizedHost) || normalizedHost.endsWith(".localhost"))
  ) {
    if (normalizedSlug === "default") {
      return "localhost";
    }
    return `${normalizedSlug}.localhost`;
  }

  const rootDomain =
    normalizedHost &&
    normalizedHost !== SAAS_ROOT_DOMAIN &&
    !normalizedHost.endsWith(`.${SAAS_ROOT_DOMAIN}`)
      ? normalizedHost.startsWith("www.")
        ? normalizedHost.slice(4)
        : normalizedHost
      : SAAS_ROOT_DOMAIN;

  if (normalizedSlug === "default") {
    return rootDomain === SAAS_ROOT_DOMAIN ? `www.${SAAS_ROOT_DOMAIN}` : rootDomain;
  }
  return `${normalizedSlug}.${rootDomain}`;
}
