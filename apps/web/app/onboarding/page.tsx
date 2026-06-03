import Link from "next/link";

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-20">
      <section className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Welcome to Canonflo
        </p>
        <h1 className="text-3xl font-semibold">Your tenant workspace is ready.</h1>
        <p className="text-zinc-700 dark:text-zinc-300">
          We&apos;ve routed you to your tenant scope. Continue to your live operations feed to
          finish setup and start ingesting signals.
        </p>
      </section>
      <section className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Continue to Workspace
        </Link>
        <Link
          href="/simulate"
          className="rounded border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
        >
          Run Simulation
        </Link>
      </section>
    </main>
  );
}
