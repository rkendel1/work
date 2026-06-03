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
  const clerkJsUrl = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
  const clerkConfigured = Boolean(
    clerkPublishableKey &&
      !clerkPublishableKey.includes("replace-with") &&
      (process.env.NODE_ENV !== "development" ||
        process.env.NEXT_PUBLIC_ENABLE_CLERK_IN_DEV === "true"),
  );

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        {clerkConfigured ? (
          <ClerkProvider publishableKey={clerkPublishableKey} clerkJSUrl={clerkJsUrl}>
            <Providers>{children}</Providers>
          </ClerkProvider>
        ) : (
          <Providers>{children}</Providers>
        )}
      </body>
    </html>
  );
}
