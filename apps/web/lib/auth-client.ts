import { createAuthClient } from "better-auth/client";
import { APP_BASE_URL } from "@/lib/runtime-config";

export const authClient = createAuthClient({
  baseURL: APP_BASE_URL,
});
