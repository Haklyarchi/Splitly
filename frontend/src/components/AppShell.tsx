import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { LogOut, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/useMe";
import { endSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { initials } from "@/lib/format";
import NotificationBell from "@/components/NotificationBell";

export function Brand() {
  return (
    <Link to="/groups" className="flex items-center gap-2 group" data-testid="brand-link">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-teal-300 transition-transform duration-200 group-hover:-rotate-6">
        <Split className="h-5 w-5" />
      </span>
      <span className="text-lg font-black tracking-tight">Splitly</span>
    </Link>
  );
}

export default function AppShell() {
  const me = useMe();
  const loc = useLocation();
  if (me.isError && me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 shadow-xs backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-3">
            {me.data && <NotificationBell />}
            {me.data && (
              <div className="hidden items-center gap-2 sm:flex" data-testid="header-user">
                <span className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-slate-100 text-xs font-bold">
                  {initials(me.data.name)}
                </span>
                <span className="text-sm font-semibold text-slate-700">{me.data.name}</span>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => void endSession()} data-testid="logout-button">
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
