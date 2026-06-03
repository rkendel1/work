export { RUST_API_URL as RUST_INGRESS_URL } from "@/lib/rust-api";

export const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const SAAS_ROOT_DOMAIN =
  process.env.NEXT_PUBLIC_SAAS_ROOT_DOMAIN ?? "canonflo.com";
