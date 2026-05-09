"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Database,
  Home,
  Inbox,
  Search,
  Settings,
  Target,
  Upload
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/targets", label: "Targets", icon: Target },
  { href: "/followups", label: "Follow-ups", icon: Inbox },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings/modules", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#F3F4F6] text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white md:block">
        <div className="flex h-16 items-center gap-3 border-b border-line px-5">
          <div className="grid size-9 place-items-center rounded-lg bg-ink text-white">
            <Database className="size-4" aria-hidden="true" />
          </div>
          <div>
            <div className="font-semibold">ReachLog</div>
            <div className="text-xs text-muted">Outreach command center</div>
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
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center gap-4 px-4 md:px-6">
            <Link href="/dashboard" className="font-semibold md:hidden">
              ReachLog
            </Link>
            <form action="/targets" className="relative ml-auto w-full max-w-xl">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                className="h-10 w-full rounded-md border border-line bg-panel pl-9 pr-3 text-sm outline-none transition focus:border-accent focus:bg-white"
                name="q"
                placeholder="Search email, domain, company..."
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
