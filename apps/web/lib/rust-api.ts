export const RUST_API_URL =
  process.env.RUST_INGRESS_URL ?? "http://127.0.0.1:8080";

export async function rustFetch(path: string, init?: RequestInit) {
  return fetch(`${RUST_API_URL}${path}`, init);
}
