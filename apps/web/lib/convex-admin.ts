type ConvexMutationArgs = Record<string, unknown>;
type ConvexQueryArgs = Record<string, unknown>;

const CONVEX_ADMIN_KEY_NAMES = [
  "CONVEX_ADMIN_KEY",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_KEY",
  "CONVEX_ACCESS_TOKEN",
] as const;

type ConvexAuth = {
  scheme: "Convex" | "Bearer";
  token: string;
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
    return token ? { scheme, token } : null;
  }

  const token = normalized.replace(/\s+/g, "");
  if (!token) {
    return null;
  }

  const inferredScheme = token.includes(".") ? "Bearer" : "Convex";
  return { scheme: inferredScheme, token };
}

function convexAdminConfig() {
  const deploymentUrl = (process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const rawAdminKey = CONVEX_ADMIN_KEY_NAMES.map((name) => process.env[name]).find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  const auth = rawAdminKey ? parseConvexAuthorization(rawAdminKey) : null;
  if (!deploymentUrl || !auth) {
    return null;
  }
  return { deploymentUrl, auth };
}

export async function runConvexAdminMutation(path: string, args: ConvexMutationArgs) {
  const config = convexAdminConfig();
  if (!config) {
    throw new Error("Convex admin credentials are not configured");
  }

  const response = await fetch(`${config.deploymentUrl}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${config.auth.scheme} ${config.auth.token}`,
    },
    body: JSON.stringify({ path, args }),
  });

  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new Error(`Convex mutation ${path} failed (${response.status}): ${body}`);
}

export async function runConvexAdminQuery<T>(path: string, args: ConvexQueryArgs) {
  const config = convexAdminConfig();
  if (!config) {
    throw new Error("Convex admin credentials are not configured");
  }

  const response = await fetch(`${config.deploymentUrl}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${config.auth.scheme} ${config.auth.token}`,
    },
    body: JSON.stringify({ path, args }),
  });

  if (response.ok) {
    return (await response.json()) as T;
  }

  const body = await response.text();
  throw new Error(`Convex query ${path} failed (${response.status}): ${body}`);
}
