import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "@/app/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Operations Inbox",
  description: "Ingress-first operations inbox",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const hasValidClerkPublishableKey = Boolean(
    clerkPublishableKey && /^pk_(test|live)_[A-Za-z0-9_-]+$/.test(clerkPublishableKey),
  );
  const clerkConfigured = Boolean(
    hasValidClerkPublishableKey &&
      (process.env.NODE_ENV !== "development" ||
        process.env.NEXT_PUBLIC_ENABLE_CLERK_IN_DEV === "true"),
  );

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        {clerkConfigured ? (
          <ClerkProvider publishableKey={clerkPublishableKey}>
            <Providers>{children}</Providers>
          </ClerkProvider>
        ) : (
          <Providers>{children}</Providers>
        )}
      </body>
    </html>
  );
}
