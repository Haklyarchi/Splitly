import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Receipt, Users } from "lucide-react";
import { apiGet } from "@/lib/api";
import { money } from "@/lib/format";
import type { GroupListItem } from "@/lib/types";
import CreateGroupDialog from "@/components/CreateGroupDialog";
import { useMe } from "@/lib/useMe";

export default function Groups() {
  const me = useMe();
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => apiGet<GroupListItem[]>("/groups") });
  const list = groups.isError ? [] : groups.data ?? [];

  return (
    <div className="space-y-10">
      <section className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Your groups</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl" data-testid="groups-heading">
            {me.data ? `Hey ${me.data.name.split(" ")[0]},` : "Hey,"}<br />
            <span className="text-slate-400">who owes whom?</span>
          </h1>
        </div>
        <CreateGroupDialog />
      </section>

      {groups.isPending && (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-200/60" />)}
        </div>
      )}

      {!groups.isPending && list.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center" data-testid="groups-empty">
          <Users className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-4 text-lg font-bold">No groups yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create one for your next trip, flat or dinner.</p>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="groups-list">
        {list.map((g, i) => (
          <Link
            key={g.id}
            to={`/groups/${g.id}`}
            style={{ animationDelay: `${i * 50}ms` }}
            className="animate-rise-in group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
            data-testid="group-card"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-slate-600">{g.currency}</span>
                <h3 className="mt-3 text-xl font-black tracking-tight" data-testid="group-card-name">{g.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{g.members.map((m) => m.name).join(", ")}</p>
              </div>
              <ArrowUpRight className="h-5 w-5 text-slate-300 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-teal-600" />
            </div>
            <div className="mt-6 flex items-end justify-between border-t border-slate-100 pt-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Total spent</p>
                <p className="money text-lg font-semibold" data-testid="group-card-total">{money(g.total_spent, g.currency)}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="flex items-center justify-end gap-1"><Receipt className="h-3.5 w-3.5" /> {g.expense_count} expenses</p>
                <p className={g.unsettled_count ? "mt-1 font-semibold text-rose-600" : "mt-1 font-semibold text-green-700"} data-testid="group-card-status">
                  {g.unsettled_count ? `${g.unsettled_count} to settle` : "All settled"}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
