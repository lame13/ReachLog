import { AppShell } from "@/components/app-shell";
import { env } from "@/modules/core/env";
import { getDueFollowupCount } from "@/modules/outreach/queries";
import { getPendingAiReviewCount } from "@/modules/ai/review";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell
      demoMode={env.DEMO_MODE}
      dueFollowups={getDueFollowupCount()}
      pendingReviews={getPendingAiReviewCount()}
    >
      {children}
    </AppShell>
  );
}
