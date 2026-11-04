import { initials, money } from "@/lib/format";
import type { Currency, MemberBalance } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function MemberBalances({ balances, currency }: { balances: MemberBalance[]; currency: Currency }) {
  const max = Math.max(1, ...balances.map((b) => Math.abs(b.net)));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]" data-testid="member-balances">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Balances</p>
      <ul className="mt-3 space-y-3">
        {balances.map((b) => {
          const pos = b.net > 0.004;
          const neg = b.net < -0.004;
          return (
            <li key={b.member_id} data-testid={`balance-row-${b.name}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-slate-100 text-[11px] font-bold">{initials(b.name)}</span>
                  <span>
                    <span className="block text-sm font-semibold">{b.name}</span>
                    <span className="block text-[11px] text-slate-500">
                      paid <span className="money">{money(b.paid, currency)}</span> · share <span className="money">{money(b.share, currency)}</span>
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    "money rounded-full px-2.5 py-1 text-xs font-semibold",
                    pos && "bg-green-100 text-green-900",
                    neg && "bg-rose-100 text-rose-900",
                    !pos && !neg && "bg-slate-100 text-slate-600",
                  )}
                  data-testid={`balance-net-${b.name}`}
                >
                  {pos ? `gets ${money(b.net, currency)}` : neg ? `owes ${money(-b.net, currency)}` : "settled"}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-500", pos ? "bg-green-500" : "bg-rose-500")}
                  style={{ width: `${(Math.abs(b.net) / max) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
