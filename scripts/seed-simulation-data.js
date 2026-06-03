"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TENANTS = [
  {
    id: "default",
    slug: "default",
    domain: "default.canonflo.com",
    name: "Default Tenant",
    displayName: "Default Tenant",
    vertical: "Property Management",
    industry: "Commercial Real Estate",
  },
  {
    id: "northstar_facilities",
    slug: "northstar_facilities",
    domain: "northstar_facilities.canonflo.com",
    name: "Northstar Facilities",
    displayName: "Northstar Facilities",
    vertical: "Property Management",
    industry: "Commercial Real Estate",
  },
  {
    id: "harbor_clinic_ops",
    slug: "harbor_clinic_ops",
    domain: "harbor_clinic_ops.canonflo.com",
    name: "Harbor Clinic Ops",
    displayName: "Harbor Clinic Ops",
    vertical: "Healthcare",
    industry: "Clinic",
  },
];

const DEFAULT_SEED_ACCOUNTS = DEFAULT_TENANTS.map((tenant) => ({
  tenantId: tenant.id,
  email: `ops+${tenant.id}@canonflo.local`,
  name: `${tenant.displayName} Operator`,
  handle: `ops-${tenant.id}`,
  role: "admin",
}));

function loadLocalEnv() {
  const envPath = path.resolve(__dirname, "..", "apps", "web", ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const envContents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of envContents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }
    const rawValue = line.slice(separatorIndex + 1).trim();
    const unquoted = rawValue.replace(/^['"]|['"]$/g, "");
    process.env[key] = unquoted;
  }

  if (!process.env.CONVEX_DEPLOYMENT_URL && process.env.NEXT_PUBLIC_CONVEX_URL) {
    process.env.CONVEX_DEPLOYMENT_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeConvexAdminKey(rawValue) {
  const withoutQuotes = rawValue.replace(/^['"]|['"]$/g, "");
  return withoutQuotes.replace(/^(?:Convex|Bearer)(?:\s+|$)/i, "").trim();
}

async function convexMutation(path, args) {
  const deploymentUrl = requiredEnv("CONVEX_DEPLOYMENT_URL");
  const adminKey = normalizeConvexAdminKey(requiredEnv("CONVEX_ADMIN_KEY"));
  if (!adminKey) {
    throw new Error("CONVEX_ADMIN_KEY is empty after removing optional authorization prefixes");
  }
  const response = await fetch(`${deploymentUrl.replace(/\/$/, "")}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Convex ${adminKey}`,
    },
    body: JSON.stringify({ path, args }),
  });

  if (response.ok) {
    return;
  }

  const errorText = await response.text();
  throw new Error(`Convex mutation ${path} failed (${response.status}): ${errorText}`);
}

async function findClerkUserByEmail(clerkSecretKey, email) {
  const url = new URL("https://api.clerk.com/v1/users");
  url.searchParams.set("limit", "100");
  url.searchParams.append("email_address[]", email);

  const response = await fetch(url, {
    headers: {
      Authorization: ["Bearer", clerkSecretKey].join(" "),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to query Clerk users (${response.status}): ${errorText}`);
  }

  const users = await response.json();
  return Array.isArray(users)
    ? users.find(
        (user) =>
          Array.isArray(user.email_addresses) &&
          user.email_addresses.some((entry) => entry.email_address === email),
      )
    : undefined;
}

async function ensureClerkLogin({ email, password, firstName, lastName }) {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!clerkSecretKey) {
    console.warn("CLERK_SECRET_KEY not set. Skipping Clerk user creation.");
    return { seeded: false };
  }

  const existing = await findClerkUserByEmail(clerkSecretKey, email);
  if (existing) {
    return { seeded: true, existed: true, id: existing.id };
  }

  const response = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: ["Bearer", clerkSecretKey].join(" "),
    },
    body: JSON.stringify({
      email_address: [email],
      password,
      first_name: firstName,
      last_name: lastName,
      skip_password_checks: false,
      skip_password_requirement: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create Clerk user (${response.status}): ${errorText}`);
  }

  const created = await response.json();
  return { seeded: true, existed: false, id: created.id };
}

async function seedTenants() {
  const createdAt = Date.now();
  for (const tenant of DEFAULT_TENANTS) {
    await convexMutation("actions:createTenant", {
      ...tenant,
      createdAt,
    });
  }
}

async function seedConvexLoginUser({ email, tenantId }) {
  await convexMutation("actions:upsertUserByEmail", {
    email,
    name: "Simulation Tester",
    handle: "sim-tester",
    role: "admin",
    tenantId,
  });
}

async function seedTenantAccount(account) {
  await convexMutation("actions:upsertUserByEmail", {
    email: account.email,
    name: account.name,
    handle: account.handle,
    role: account.role,
    tenantId: account.tenantId,
  });
}

async function seedTenantDataset(account) {
  await convexMutation("actions:seedTenantDataset", {
    tenantId: account.tenantId,
    userEmail: account.email,
    userName: account.name,
    userHandle: account.handle,
  });
}

async function main() {
  loadLocalEnv();
  const seedEmail = process.env.SEED_TEST_LOGIN_EMAIL?.trim() || "sim.tester@canonflo.local";
  const seedPassword = process.env.SEED_TEST_LOGIN_PASSWORD?.trim() || "SimTester#2026";
  const seedFirstName = process.env.SEED_TEST_LOGIN_FIRST_NAME?.trim() || "Simulation";
  const seedLastName = process.env.SEED_TEST_LOGIN_LAST_NAME?.trim() || "Tester";

  console.log("Seeding default simulation tenants...");
  await seedTenants();

  console.log("Seeding test login...");
  const clerkResult = await ensureClerkLogin({
    email: seedEmail,
    password: seedPassword,
    firstName: seedFirstName,
    lastName: seedLastName,
  });
  await seedConvexLoginUser({ email: seedEmail, tenantId: DEFAULT_TENANTS[0].id });

  console.log("Seeding tenant accounts and full dataset...");
  for (const account of DEFAULT_SEED_ACCOUNTS) {
    await seedTenantAccount(account);
    await seedTenantDataset(account);
  }

  console.log("");
  console.log("Seed complete.");
  console.log(`Login email: ${seedEmail}`);
  console.log(`Login password: ${seedPassword}`);
  console.log(`Seeded tenant accounts: ${DEFAULT_SEED_ACCOUNTS.map((account) => account.email).join(", ")}`);
  if (clerkResult.seeded) {
    console.log(`Clerk user: ${clerkResult.existed ? "already existed" : "created"}`);
  } else {
    console.log("Clerk user: skipped (set CLERK_SECRET_KEY to create it)");
  }
}

main().catch((error) => {
  console.error("Seed failed:", error.message);
  process.exitCode = 1;
});
