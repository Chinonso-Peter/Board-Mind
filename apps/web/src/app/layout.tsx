import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BoardMind — Collaborative AI Architecture Whiteboard",
  description: "Offline-tolerant, real-time collaborative system architecture whiteboard with passive AI design-review mutations.",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#4f46e5" />
      </head>
      <body className="antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
