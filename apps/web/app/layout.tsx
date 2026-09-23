import type { Metadata, Viewport } from "next";
import { eq } from "drizzle-orm";
import { escalations } from "@cai/db";
import { withDb } from "@/lib/db";
import { TabBar } from "@/components/TabBar";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cai Career Agent",
  description: "Command center for Cai's autonomous job search.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Cai Career",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfbf8" },
    { media: "(prefers-color-scheme: dark)", color: "#16130f" },
  ],
};

async function getOpenEscalationCount(): Promise<number> {
  const result = await withDb(async (db) => {
    const rows = await db
      .select({ id: escalations.id })
      .from(escalations)
      .where(eq(escalations.status, "OPEN"));
    return rows.length;
  });
  return result.ok ? result.data : 0;
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const needsYouCount = await getOpenEscalationCount();

  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] antialiased">
        <div className="mx-auto flex min-h-screen max-w-xl flex-col pb-20">
          {children}
        </div>
        <TabBar needsYouCount={needsYouCount} />
      </body>
    </html>
  );
}
