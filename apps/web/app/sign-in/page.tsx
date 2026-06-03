"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);

    const response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      }),
    });

    setIsSubmitting(false);
    if (!response.ok) {
      setError(await response.text());
      return;
    }

    window.location.assign("/");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border bg-white p-5">
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
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <p className="text-sm text-zinc-600">
        New here?{" "}
        <Link href="/sign-up" className="underline">
          Create your tenant
        </Link>
      </p>
    </main>
  );
}
