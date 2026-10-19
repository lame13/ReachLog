"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Bot,
  Building2,
  CircleDollarSign,
  Database,
  FileText,
  Home,
  Inbox,
  Menu,
  Search,
  Settings,
  Target,
  Upload,
  Users,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/pipeline", label: "Pipeline", icon: CircleDollarSign },
  { href: "/accounts", label: "Accounts", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/targets", label: "Targets", icon: Target },
  { href: "/followups", label: "Follow-ups", icon: Inbox },
  { href: "/review", label: "AI review", icon: Bot },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings/modules", label: "Settings", icon: Settings }
];

export function AppShell({
  children,
  demoMode = false,
  dueFollowups = 0,
  pendingReviews = 0
}: {
  children: React.ReactNode;
  demoMode?: boolean;
  dueFollowups?: number;
  pendingReviews?: number;
}) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F3F4F6] text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white md:block">
        <div className="flex h-16 items-center gap-3 border-b border-line px-5">
          <div className="grid size-9 place-items-center rounded-lg bg-ink text-white">
            <Database className="size-4" aria-hidden="true" />
          </div>
          <div>
            <div className="font-semibold">ReachLog</div>
            <div className="text-xs text-muted">Outreach tracker</div>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted transition hover:bg-panel hover:text-ink",
                  active && "bg-panel text-ink"
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
                <NavBadge
                  count={
                    item.href === "/followups"
                      ? dueFollowups
                      : item.href === "/review"
                        ? pendingReviews
                        : 0
                  }
                  noun={item.href === "/review" ? "review item" : "follow-up"}
                />
              </Link>
            );
          })}
        </nav>
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/35"
            onClick={() => setMobileMenuOpen(false)}
            type="button"
          />
          <div className="relative flex h-full w-[min(84vw,320px)] flex-col border-r border-line bg-white shadow-soft">
            <div className="flex h-16 items-center justify-between border-b border-line px-4">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-lg bg-ink text-white">
                  <Database className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <div className="font-semibold">ReachLog</div>
                  <div className="text-xs text-muted">Outreach tracker</div>
                </div>
              </div>
              <button
                aria-label="Close navigation"
                className="grid size-9 place-items-center rounded-md text-muted hover:bg-panel hover:text-ink"
                onClick={() => setMobileMenuOpen(false)}
                type="button"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <nav className="space-y-1 p-3">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted transition hover:bg-panel hover:text-ink",
                      active && "bg-panel text-ink"
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {item.label}
                    <NavBadge
                      count={
                        item.href === "/followups"
                          ? dueFollowups
                          : item.href === "/review"
                            ? pendingReviews
                            : 0
                      }
                      noun={item.href === "/review" ? "review item" : "follow-up"}
                    />
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      <div className="md:pl-64">
        {demoMode && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 md:px-6">
            Read-only demo: explore sample data. Changes and sending are disabled.
          </div>
        )}

        <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
          <div className="flex flex-col gap-3 px-4 py-3 md:h-16 md:flex-row md:items-center md:gap-4 md:px-6 md:py-0">
            <div className="flex h-10 items-center gap-2 md:hidden">
              <button
                aria-label="Open navigation"
                className="grid size-10 place-items-center rounded-md border border-line bg-white text-ink hover:bg-panel"
                onClick={() => setMobileMenuOpen(true)}
                type="button"
              >
                <Menu className="size-5" aria-hidden="true" />
              </button>
              <Link href="/dashboard" className="font-semibold">
                ReachLog
              </Link>
            </div>
            <form action="/targets" className="relative w-full md:ml-auto md:max-w-xl">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                className="h-10 w-full rounded-md border border-line bg-panel pl-9 pr-3 text-sm outline-none transition focus:border-accent focus:bg-white"
                aria-label="Search targets, messages and contact forms"
                name="q"
                placeholder="Search company, email, message text..."
                type="search"
              />
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}

function NavBadge({ count, noun }: { count: number; noun: string }) {
  if (count <= 0) {
    return null;
  }

  return (
    <>
      <span
        className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-900"
        aria-hidden="true"
      >
        {count > 99 ? "99+" : count}
      </span>
      <span className="sr-only">
        {count === 1 ? `1 ${noun}` : `${count} ${noun}s`}
      </span>
    </>
  );
}
