"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type Tab = {
  href: string;
  label: string;
  icon: (active: boolean) => ReactNode;
  badge?: number;
};

function HomeIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.25 : 1.75} stroke="currentColor" className="h-6 w-6">
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NeedsYouIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.25 : 1.75} stroke="currentColor" className="h-6 w-6">
      <path d="M12 3v10" strokeLinecap="round" />
      <path d="M12 3c3.5 2 5 5 5 8.5a5 5 0 1 1-10 0C7 8 8.5 5 12 3Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ActivityIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.25 : 1.75} stroke="currentColor" className="h-6 w-6">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PipelineIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.25 : 1.75} stroke="currentColor" className="h-6 w-6">
      <rect x="3.5" y="4" width="5" height="16" rx="1.2" />
      <rect x="9.75" y="4" width="5" height="11" rx="1.2" />
      <rect x="16" y="4" width="5" height="7" rx="1.2" />
    </svg>
  );
}

function CareerIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.25 : 1.75} stroke="currentColor" className="h-6 w-6">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TabBar({ needsYouCount }: { needsYouCount: number }) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { href: "/", label: "Home", icon: HomeIcon },
    { href: "/needs-you", label: "Needs You", icon: NeedsYouIcon, badge: needsYouCount },
    { href: "/activity", label: "Activity", icon: ActivityIcon },
    { href: "/pipeline", label: "Pipeline", icon: PipelineIcon },
    { href: "/career", label: "Career", icon: CareerIcon },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-between px-1">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className="relative flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium"
                style={{ color: active ? "var(--color-accent)" : "var(--color-text-muted)" }}
              >
                <span className="relative">
                  {tab.icon(active)}
                  {tab.badge ? (
                    <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-critical)] px-1 text-[10px] font-semibold leading-none text-white">
                      {tab.badge > 99 ? "99+" : tab.badge}
                    </span>
                  ) : null}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
