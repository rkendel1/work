type ConvexMutationArgs = Record<string, unknown>;
type ConvexQueryArgs = Record<string, unknown>;
type ConvexAuthScheme = "Convex" | "Bearer";

const CONVEX_ADMIN_KEY_NAMES = [
  "CONVEX_ADMIN_KEY",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_KEY",
  "CONVEX_ACCESS_TOKEN",
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
  const deploymentUrl = (process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
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

  if (!deploymentUrl || uniqueCandidates.length === 0) {
    return null;
  }
  return { deploymentUrl, candidates: uniqueCandidates };
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
  for (const candidate of config.candidates) {
    for (const scheme of schemesForAuth(candidate.auth)) {
      const response = await fetch(`${config.deploymentUrl}/api/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${scheme} ${candidate.auth.token}`,
        },
        body: JSON.stringify({ path, args }),
      });

      if (response.ok) {
        return await parse(response);
      }

      const body = await response.text();
      errors.push(`${candidate.name}:${scheme}:${response.status}:${body}`);
      if (response.status !== 401) {
        break;
      }
    }
  }

  const details = errors[errors.length - 1];
  throw new Error(`Convex ${endpoint} ${path} failed (${details})`);
}

export async function runConvexAdminMutation(path: string, args: ConvexMutationArgs) {
  await runConvexAdminRequest("mutation", path, args, async () => undefined);
}

export async function runConvexAdminQuery<T>(path: string, args: ConvexQueryArgs) {
  return await runConvexAdminRequest("query", path, args, async (response) => (await response.json()) as T);
}
