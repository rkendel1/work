type ConvexMutationArgs = Record<string, unknown>;
type ConvexQueryArgs = Record<string, unknown>;

function normalizeConvexAdminKey(rawValue: string): string {
  let normalized = rawValue.trim().replace(/^['"]|['"]$/g, "");
  normalized = normalized.replace(
    /^(?:CONVEX_ADMIN_KEY|CONVEX_DEPLOY_KEY|CONVEX_DEPLOYMENT_KEY|CONVEX_ACCESS_TOKEN)\s*=\s*/i,
    "",
  );
  normalized = normalized.replace(/^authorization\s*:\s*/i, "");
  normalized = normalized.replace(/^(?:Convex|Bearer)(?:\s+|$)/i, "").trim();
  return normalized.replace(/\s+/g, "");
}

function convexAdminConfig() {
  const deploymentUrl = (process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const rawAdminKey = process.env.CONVEX_ADMIN_KEY ?? "";
  const adminKey = normalizeConvexAdminKey(rawAdminKey);
  if (!deploymentUrl || !adminKey) {
    return null;
  }
  return { deploymentUrl, adminKey };
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
      Authorization: `Convex ${config.adminKey}`,
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
      Authorization: `Convex ${config.adminKey}`,
    },
    body: JSON.stringify({ path, args }),
  });

  if (response.ok) {
    return (await response.json()) as T;
  }

  const body = await response.text();
  throw new Error(`Convex query ${path} failed (${response.status}): ${body}`);
}
