import type { Metadata } from "next";
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
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-950">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
