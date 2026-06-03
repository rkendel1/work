"use client";

import { SignOutButton } from "@clerk/nextjs";

type SessionUserControlsProps = {
  userIdentifier: string;
};

export function SessionUserControls({ userIdentifier }: SessionUserControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">
        Signed in as{" "}
        <strong className="text-zinc-900 dark:text-zinc-100">{userIdentifier}</strong>
      </span>
      <SignOutButton redirectUrl="/sign-in">
        <button
          type="button"
          className="rounded border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Log out
        </button>
      </SignOutButton>
    </div>
  );
}
