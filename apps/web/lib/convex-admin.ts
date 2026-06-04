type ConvexMutationArgs = Record<string, unknown>;
type ConvexQueryArgs = Record<string, unknown>;
type ConvexAuthScheme = "Convex" | "Bearer";
type ConvexApiEnvelope<T> =
  | { status: "success"; value: T }
  | { status: "error"; errorMessage?: string };

const CONVEX_ADMIN_KEY_NAMES = [
  "CONVEX_ADMIN_KEY",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_KEY",
  "CONVEX_ACCESS_TOKEN",
] as const;
const CONVEX_URL_NAMES = [
  "CONVEX_ADMIN_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_URL",
  "CONVEX_DEPLOYMENT_URL",
] as const;

type ConvexAuth = {
  scheme: ConvexAuthScheme;
  token: string;
  explicitScheme: boolean;
};

type ConvexAuthCandidate = {
  name: (typeof CONVEX_ADMIN_KEY_NAMES)[number];
  auth: ConvexAuth;
};

function parseConvexAuthorization(rawValue: string): ConvexAuth | null {
  let normalized = rawValue.trim().replace(/^['"]|['"]$/g, "");
  normalized = normalized.replace(/^export\s+/i, "");
  normalized = normalized.replace(
    /^(?:CONVEX_ADMIN_KEY|CONVEX_DEPLOY_KEY|CONVEX_DEPLOYMENT_KEY|CONVEX_ACCESS_TOKEN)\s*=\s*/i,
    "",
  );
  normalized = normalized.replace(/^authorization\s*:\s*/i, "").trim();
  if (!normalized) {
    return null;
  }

  const withScheme = normalized.match(/^(Convex|Bearer)\s+(.+)$/i);
  if (withScheme) {
    const scheme = withScheme[1].toLowerCase() === "bearer" ? "Bearer" : "Convex";
    const token = withScheme[2].trim().replace(/\s+/g, "");
    return token ? { scheme, token, explicitScheme: true } : null;
  }

  const token = normalized.replace(/\s+/g, "");
  if (!token) {
    return null;
  }

  return { scheme: "Convex", token, explicitScheme: false };
}

function isJwtLikeToken(token: string) {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

function convexAdminConfig() {
  const deploymentUrls = CONVEX_URL_NAMES.map((name) => process.env[name] ?? "")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter((value) => value.length > 0)
    .filter((value, index, all) => all.indexOf(value) === index);
  const candidates: ConvexAuthCandidate[] = [];
  for (const name of CONVEX_ADMIN_KEY_NAMES) {
    const rawValue = process.env[name];
    if (!rawValue || !rawValue.trim()) {
      continue;
    }
    const auth = parseConvexAuthorization(rawValue);
    if (!auth) {
      continue;
    }
    candidates.push({ name, auth });
  }

  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((candidate) => {
    const key = `${candidate.auth.scheme}::${candidate.auth.token}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  if (deploymentUrls.length === 0 || uniqueCandidates.length === 0) {
    return null;
  }
  return { deploymentUrls, candidates: uniqueCandidates };
}

function schemesForAuth(auth: ConvexAuth): ConvexAuthScheme[] {
  if (!auth.explicitScheme) {
    return isJwtLikeToken(auth.token) ? ["Bearer", "Convex"] : ["Convex"];
  }
  return auth.scheme === "Bearer" ? ["Bearer", "Convex"] : ["Convex", "Bearer"];
}

async function runConvexAdminRequest<T>(
  endpoint: "mutation" | "query",
  path: string,
  args: Record<string, unknown>,
  parse: (response: Response) => Promise<T>,
) {
  const config = convexAdminConfig();
  if (!config) {
    throw new Error("Convex admin credentials are not configured");
  }

  const errors: string[] = [];
  for (const deploymentUrl of config.deploymentUrls) {
    for (const candidate of config.candidates) {
      for (const scheme of schemesForAuth(candidate.auth)) {
        const response = await fetch(`${deploymentUrl}/api/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `${scheme} ${candidate.auth.token}`,
          },
          body: JSON.stringify({ path, args }),
        });

        if (response.ok) {
          try {
            return await parse(response);
          } catch (error) {
            errors.push(
              `${deploymentUrl}:${candidate.name}:${scheme}:ok:${error instanceof Error ? error.message : "parse_failed"}`,
            );
            continue;
          }
        }

        const body = await response.text();
        errors.push(`${deploymentUrl}:${candidate.name}:${scheme}:${response.status}:${body}`);
      }
    }
  }

  const details = errors[errors.length - 1];
  throw new Error(`Convex ${endpoint} ${path} failed (${details})`);
}

export async function runConvexAdminMutation(path: string, args: ConvexMutationArgs) {
  await runConvexAdminRequest("mutation", path, args, async (response) => {
    const payload = (await response.json()) as ConvexApiEnvelope<unknown>;
    if (payload && typeof payload === "object" && "status" in payload) {
      if (payload.status === "error") {
        throw new Error(payload.errorMessage ?? "Unknown Convex mutation error");
      }
    }
  });
}

export async function runConvexAdminQuery<T>(path: string, args: ConvexQueryArgs) {
  return await runConvexAdminRequest("query", path, args, async (response) => {
    const payload = (await response.json()) as ConvexApiEnvelope<T> | T;
    if (payload && typeof payload === "object" && "status" in payload) {
      if (payload.status === "error") {
        throw new Error(payload.errorMessage ?? "Unknown Convex query error");
      }
      return payload.value;
    }
    return payload;
  });
}
