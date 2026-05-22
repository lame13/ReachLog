import { AppShell } from "@/components/app-shell";
import { env } from "@/modules/core/env";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return <AppShell demoMode={env.DEMO_MODE}>{children}</AppShell>;
}
