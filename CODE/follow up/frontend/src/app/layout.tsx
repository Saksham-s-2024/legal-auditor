import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Legal-Auditor v2.0",
  description: "Enterprise-grade hierarchical RAG legal auditor",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-sovereign-900 text-gray-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
