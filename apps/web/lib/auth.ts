import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { APP_BASE_URL } from "@/lib/runtime-config";

const globalForAuth = globalThis as typeof globalThis & {
  __operationsInboxMemoryDb?: Record<string, unknown[]>;
};

const memoryDb = globalForAuth.__operationsInboxMemoryDb ?? {};

if (process.env.NODE_ENV !== "production") {
  globalForAuth.__operationsInboxMemoryDb = memoryDb;
}

export const auth = betterAuth({
  database: memoryAdapter(memoryDb),
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "replace-this-in-production-with-a-long-secret",
  baseURL: APP_BASE_URL,
  trustedOrigins: [APP_BASE_URL],
  emailAndPassword: {
    enabled: true,
  },
  plugins: [nextCookies()],
});

export const authHandler = toNextJsHandler(auth);
