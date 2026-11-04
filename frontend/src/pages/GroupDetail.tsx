import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ChevronDown, History, Receipt, Search, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ExpenseChangeLog from "@/components/ExpenseChangeLog";
import ReceiptButton from "@/components/ReceiptButton";
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet } from "@/lib/api";
import { format, parseISO } from "date-fns";
import { errorMessage, money } from "@/lib/format";
import type { Expense, Group, GroupSummary } from "@/lib/types";
import AddExpenseDialog from "@/components/AddExpenseDialog";
import SettleUpSummary from "@/components/SettleUpSummary";
import MemberBalances from "@/components/MemberBalances";
import ManageGroupDialog from "@/components/ManageGroupDialog";

const ALL = "__all__";
const SPLIT_LABEL = { equal: "Split equally", exact: "Exact amounts", full: "Owed in full", items: "By item" } as const;

export default function GroupDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const group = useQuery({ queryKey: ["group", id], queryFn: () => apiGet<Group>(`/groups/${id}`) });
  const expenses = useQuery({ queryKey: ["group", id, "expenses"], queryFn: () => apiGet<Expense[]>(`/groups/${id}/expenses`) });
  const summary = useQuery({ queryKey: ["group", id, "summary"], queryFn: () => apiGet<GroupSummary>(`/groups/${id}/summary`) });

  const del = useMutation({
    mutationFn: (eid: string) => apiDelete(`/groups/${id}/expenses/${eid}`),
    onSuccess: () => {
      toast("Expense deleted");
      qc.invalidateQueries({ queryKey: ["group", id] });
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not delete")),
  });

  const g = group.isError ? undefined : group.data;
  const list = expenses.isError ? [] : expenses.data ?? [];
  const sum = summary.isError ? undefined : summary.data;
  const nameOf = (mid: string) => g?.members.find((m) => m.id === mid)?.name ?? "?";
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState<string>(ALL);
  const q = search.trim().toLowerCase();
  const filtering = q !== "" || payer !== ALL;
  const matches = (e: Expense) =>
    (payer === ALL || e.paid_by === payer) &&
    (!q || e.description.toLowerCase().includes(q) || nameOf(e.paid_by).toLowerCase().includes(q) || e.amount.toFixed(2).includes(q));
  const shown = list.filter(matches);
  const active = shown.filter((e) => !e.settled);
  const history = shown.filter((e) => e.settled);
  const [showHistory, setShowHistory] = useState(false);
  const toggleHistory = () => setShowHistory((v) => !v);
  const historyOpen = showHistory || filtering;
  const clearFilters = () => { setSearch(""); setPayer(ALL); };

  const receiptFor = (e: Expense, grp: Group) => (
    <ReceiptButton
      path={`/groups/${grp.id}/expenses/${e.id}/receipt`}
      hasReceipt={e.has_receipt}
      title={`Receipt · ${e.description}`}
      invalidateKey={["group", grp.id, "expenses"]}
    />
  );

  const renderExpense = (e: Expense, i: number, grp: Group) => (
    <article
      key={e.id}
      style={{ animationDelay: `${i * 40}ms` }}
      className={`animate-rise-in group flex items-center gap-4 rounded-2xl border p-4 transition-shadow duration-200 ${
        e.settled
          ? "border-slate-200/70 bg-slate-50 text-slate-500"
          : "border-slate-200 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
      }`}
      data-testid={e.settled ? "settled-expense-item" : "expense-item"}
    >
      <div className="hidden w-12 shrink-0 text-center sm:block">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{e.date.length === 10 ? format(parseISO(e.date), "MMM") : ""}</p>
        <p className="text-xl font-black leading-none">{e.date.length === 10 ? format(parseISO(e.date), "d") : e.date}</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-bold" data-testid="expense-item-description">
          <span className="truncate">{e.description}</span>
          {e.settled && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-800" data-testid="expense-settled-badge">Settled</span>}
          {e.has_receipt && receiptFor(e, grp)}
          <ExpenseChangeLog expense={e} />
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{nameOf(e.paid_by)}</span> paid ·{" "}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">{SPLIT_LABEL[e.split_type]}</span>
        </p>
        <p className="mt-1 truncate text-[11px] text-slate-400">
          {Object.entries(e.shares).map(([m, v]) => `${nameOf(m)} ${money(v, grp.currency)}`).join(" · ")}
        </p>
      </div>
      <p className="money shrink-0 text-lg font-semibold" data-testid="expense-item-amount">{money(e.amount, grp.currency)}</p>
      <div className="flex shrink-0 items-center opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        {!e.has_receipt && receiptFor(e, grp)}
        <AddExpenseDialog group={grp} expense={e} />
        <Button
          size="icon-sm" variant="ghost" aria-label="Delete expense"
          className="text-slate-300 hover:text-rose-600"
          onClick={() => { if (window.confirm(`Delete "${e.description}"?`)) del.mutate(e.id); }}
          data-testid="delete-expense-button"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );

  return (
    <div className="space-y-8">
      <Link to="/groups" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-150 hover:text-slate-900" data-testid="back-to-groups">
        <ArrowLeft className="h-4 w-4" /> All groups
      </Link>

      <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">{g ? `${g.currency} · ${g.members.length} people` : "Group"}</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl" data-testid="group-title">
            {g?.name ?? (group.isError ? "Group unavailable" : "Loading…")}
          </h1>
          {sum && g && (
            <p className="mt-2 text-sm text-slate-500">
              Total spent <span className="money font-semibold text-slate-900" data-testid="group-total-spent">{money(sum.total_spent, g.currency)}</span>
            </p>
          )}
        </div>
        {g && (
          <div className="flex gap-2">
            <ManageGroupDialog group={g} />
            <AddExpenseDialog group={g} />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <section className="space-y-3 lg:col-span-7" data-testid="expense-list">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Expenses</p>
            {g && list.length > 0 && (
              <div className="flex gap-2" data-testid="expense-filters">
                <div className="relative flex-1 sm:w-56 sm:flex-none">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(ev) => setSearch(ev.target.value)}
                    placeholder="Search bills…"
                    className="h-9 bg-white pl-9"
                    data-testid="expense-search-input"
                  />
                </div>
                <Select value={payer} onValueChange={(v) => setPayer((v as string) ?? ALL)}>
                  <SelectTrigger className="h-9 w-36 bg-white" data-testid="expense-payer-filter">
                    <SelectValue>{(v) => (v === ALL ? "Anyone paid" : `${nameOf(v as string)} paid`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL} data-testid="payer-filter-option-all">Anyone paid</SelectItem>
                    {g.members.map((m) => (
                      <SelectItem key={m.id} value={m.id} data-testid={`payer-filter-option-${m.name}`}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {filtering && (
            <div className="flex items-center justify-between rounded-xl bg-teal-50 px-4 py-2 text-sm text-teal-900" data-testid="expense-filter-summary">
              <span>{shown.length} of {list.length} bills match{history.length ? ` · ${history.length} in History` : ""}</span>
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold hover:underline" data-testid="clear-expense-filters">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          )}
          {filtering && shown.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-muted-foreground" data-testid="expense-no-matches">
              No bills match your search.
            </div>
          )}
          {expenses.isPending && [0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-200/60" />)}
          {!expenses.isPending && list.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center" data-testid="expenses-empty">
              <Receipt className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 font-bold">No expenses yet</p>
              <p className="text-sm text-muted-foreground">Add the first bill to start tracking.</p>
            </div>
          )}
          {!expenses.isPending && !filtering && active.length === 0 && history.length > 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-5 text-green-900" data-testid="expenses-all-settled">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-sm font-semibold">All expenses are settled. New bills will show up here.</p>
            </div>
          )}
          {g && active.map((e, i) => renderExpense(e, i, g))}

          {g && history.length > 0 && (
            <div className="pt-4" data-testid="expense-history">
              <button
                type="button"
                onClick={toggleHistory}
                disabled={filtering}
                aria-expanded={historyOpen}
                className="flex w-full items-center justify-between rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-3 text-sm font-semibold text-slate-600 transition-colors duration-150 hover:bg-white hover:text-slate-900"
                data-testid="expense-history-toggle"
              >
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4" /> History · {history.length} settled {history.length === 1 ? "expense" : "expenses"}
                </span>
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  {filtering ? "Showing matches" : showHistory ? "Hide" : "Show"}
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${historyOpen ? "rotate-180" : ""}`} />
                </span>
              </button>
              {historyOpen && (
                <div className="mt-3 space-y-3" data-testid="expense-history-list">
                  {history.map((e, i) => renderExpense(e, i, g))}
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:col-span-5">
          {g && <SettleUpSummary key={g.id} group={g} summary={sum} />}
          {g && sum && <MemberBalances balances={sum.balances} currency={g.currency} />}
        </aside>
      </div>
    </div>
  );
}
