"use client";

import { tenantDomainFromSlug } from "@/lib/tenant-routing";
import { FormEvent, useState } from "react";

function slugifyTenant(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function SignUpPage() {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);

    const tenantName = String(formData.get("tenantName") ?? "");
    const slug = slugifyTenant(String(formData.get("slug") ?? "")) || slugifyTenant(tenantName);

    const authResponse = await fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        name: String(formData.get("name") ?? ""),
      }),
    });

    if (!authResponse.ok) {
      setIsSubmitting(false);
      setError(await authResponse.text());
      return;
    }

    const tenantResponse = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantName,
        slug,
        vertical: String(formData.get("vertical") ?? ""),
        industry: String(formData.get("industry") ?? ""),
      }),
    });

    setIsSubmitting(false);
    if (!tenantResponse.ok) {
      setError(await tenantResponse.text());
      return;
    }

    window.location.assign(`https://${tenantDomainFromSlug(slug)}`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold">Create tenant</h1>
      <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border bg-white p-5">
        <input
          name="name"
          required
          placeholder="Your name"
          className="rounded border px-3 py-2"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="rounded border px-3 py-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="rounded border px-3 py-2"
        />
        <input
          name="tenantName"
          required
          placeholder="Tenant name"
          className="rounded border px-3 py-2"
        />
        <input name="slug" placeholder="Tenant slug (optional)" className="rounded border px-3 py-2" />
        <input
          name="vertical"
          placeholder="Vertical (optional)"
          className="rounded border px-3 py-2"
        />
        <input
          name="industry"
          placeholder="Industry (optional)"
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? "Creating tenant..." : "Create tenant"}
        </button>
      </form>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </main>
  );
}
