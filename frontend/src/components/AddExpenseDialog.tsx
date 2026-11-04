import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Equal, ListChecks, ListOrdered, Loader2, Pencil, Plus, ScanLine, User as UserIcon, X } from "lucide-react";
import ItemSplitEditor, { newDraftItem, type DraftItem } from "@/components/ItemSplitEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiPost, apiPut } from "@/lib/api";
import { errorMessage, money } from "@/lib/format";
import { compressImage } from "@/lib/image";
import type { Expense, ExpenseCreate, Group, ReceiptIn, ReceiptScan, SplitType } from "@/lib/types";
import { cn } from "@/lib/utils";

const SPLITS: { type: SplitType; label: string; hint: string; icon: typeof Equal }[] = [
  { type: "equal", label: "Equally", hint: "Divide evenly among selected people", icon: Equal },
  { type: "exact", label: "Exact", hint: "Enter what each person owes", icon: ListOrdered },
  { type: "full", label: "In full", hint: "One person owes the whole amount", icon: UserIcon },
  { type: "items", label: "By item", hint: "Tick who had each item on the receipt", icon: ListChecks },
];

export default function AddExpenseDialog({ group, expense }: { group: Group; expense?: Expense }) {
  const isEdit = !!expense;
  const qc = useQueryClient();
  const allIds = group.members.map((m) => m.id);
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";

  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(allIds[0] ?? "");
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [selected, setSelected] = useState<string[]>(allIds);
  const [exact, setExact] = useState<Record<string, string>>({});
  const [fullOwer, setFullOwer] = useState(allIds[1] ?? allIds[0] ?? "");
  const [date, setDate] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    if (expense) {
      const ids = Object.keys(expense.shares);
      setDescription(expense.description); setAmount(String(expense.amount));
      setPaidBy(expense.paid_by); setSplitType(expense.split_type);
      setSelected(expense.split_type === "equal" ? ids : allIds);
      setExact(expense.split_type === "exact"
        ? Object.fromEntries(Object.entries(expense.shares).map(([k, v]) => [k, String(v)]))
        : {});
      setFullOwer(expense.split_type === "full" ? ids[0]! : allIds[1] ?? allIds[0] ?? "");
      setDate(expense.date); setReceipt(null); setScanNote(null);
      setItems((expense.items ?? []).map((it) => newDraftItem(it.name, String(it.price), it.member_ids)));
      return;
    }
    setDate(""); setReceipt(null); setScanNote(null); setItems([]);
    setDescription(""); setAmount(""); setPaidBy(allIds[0] ?? ""); setSplitType("equal");
    setSelected(allIds); setExact({}); setFullOwer(allIds[1] ?? allIds[0] ?? "");
  };

  const total = Number(amount) || 0;
  const exactSum = useMemo(
    () => Object.values(exact).reduce((s, v) => s + (Number(v) || 0), 0),
    [exact],
  );
  const remaining = Math.round((total - exactSum) * 100) / 100;
  const perHead = selected.length ? total / selected.length : 0;

  const scan = useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith("image/")) throw new Error("not-image");
      const data_url = await compressImage(file);
      setReceipt(data_url);
      return apiPost<ReceiptScan>("/receipts/scan", { data_url } satisfies ReceiptIn);
    },
    onSuccess: (r) => {
      const found: string[] = [];
      if (r.amount) { setAmount(r.amount.toFixed(2)); found.push("amount"); }
      if (r.description) { setDescription(r.description); found.push("description"); }
      if (r.date) { setDate(r.date); found.push("date"); }
      if (r.items.length) {
        setItems(r.items.map((it) => newDraftItem(it.name, it.price.toFixed(2), allIds)));
        setSplitType("items");
        found.push(`${r.items.length} items`);
      }
      const curWarn = r.currency && r.currency !== group.currency
        ? ` Heads up: the receipt looks like ${r.currency}, this group uses ${group.currency}.` : "";
      setScanNote(found.length
        ? `Filled in ${found.join(", ")} from the receipt — please double-check${r.items.length ? " and tick who had each item" : ""}.${curWarn}`
        : "Couldn't read this receipt clearly — please type the details. The photo will still be attached.");
      if (found.length) toast.success("Receipt scanned");
    },
    onError: (e) => {
      setScanNote(null);
      toast.error(e instanceof Error && e.message === "not-image" ? "Please pick an image file" : errorMessage(e, "Could not scan receipt"));
    },
  });

  const mut = useMutation({
    mutationFn: async (body: ExpenseCreate) => {
      if (expense) return apiPut<Expense>(`/groups/${group.id}/expenses/${expense.id}`, body);
      const created = await apiPost<Expense>(`/groups/${group.id}/expenses`, body);
      if (receipt) {
        await apiPut(`/groups/${group.id}/expenses/${created.id}/receipt`, { data_url: receipt } satisfies ReceiptIn)
          .catch(() => toast.error("Expense saved, but the receipt photo couldn't be attached"));
      }
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group", group.id] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      toast.success(isEdit ? "Expense updated" : "Expense added");
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, isEdit ? "Could not update expense" : "Could not add expense")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (total <= 0) return toast.error("Enter an amount above zero");
    if (splitType === "equal" && !selected.length) return toast.error("Select at least one person");
    if (splitType === "exact" && Math.abs(remaining) >= 0.005) return toast.error(`Amounts must add up to ${money(total, group.currency)}`);
    if (splitType === "items") {
      if (!items.length) return toast.error("Add at least one item");
      const bad = items.find((it) => !it.name.trim() || !(Number(it.price) > 0));
      if (bad) return toast.error("Every item needs a name and a price");
      const nobody = items.find((it) => !it.member_ids.length);
      if (nobody) return toast.error(`Pick who had "${nobody.name}"`);
    }
    mut.mutate({
      description,
      amount: total,
      paid_by: paidBy,
      split_type: splitType,
      participant_ids: splitType === "equal" ? selected : splitType === "full" ? [fullOwer] : [],
      exact_amounts: splitType === "exact"
        ? Object.fromEntries(Object.entries(exact).map(([k, v]) => [k, Number(v) || 0]))
        : {},
      items: splitType === "items"
        ? items.map((it) => ({ name: it.name.trim(), price: Number(it.price), member_ids: it.member_ids }))
        : [],
      date: date || null,
    });
  };

  const memberSelect = (value: string, onChange: (v: string) => void, testid: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" data-testid={testid}>
        <SelectValue>{(v) => nameOf(v as string)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {group.members.map((m) => (
          <SelectItem key={m.id} value={m.id} data-testid={`${testid}-option-${m.name}`}>{m.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isEdit ? (
        <DialogTrigger
          onClick={reset}
          render={<Button size="icon-sm" variant="ghost" aria-label="Edit expense" className="text-slate-400 hover:text-teal-700" data-testid="edit-expense-button" />}
        >
          <Pencil className="h-4 w-4" />
        </DialogTrigger>
      ) : (
        <DialogTrigger onClick={reset} render={<Button className="h-11 px-5 font-semibold" data-testid="add-expense-button" />}>
          <Plus className="h-4 w-4" /> Add expense
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight">{isEdit ? "Edit expense" : "Add an expense"}</DialogTitle>
            <DialogDescription>Who paid, how much, and how it should be split.</DialogDescription>
          </DialogHeader>

          {!isEdit && (
            <div className="rounded-xl border border-dashed border-teal-300 bg-teal-50/60 p-3" data-testid="receipt-scan-panel">
              <input
                ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) scan.mutate(f); }}
                data-testid="scan-receipt-file-input"
              />
              <div className="flex items-center gap-3">
                {receipt ? (
                  <img src={receipt} alt="Receipt preview" className="h-14 w-11 shrink-0 rounded-md border border-teal-200 object-cover" data-testid="scan-receipt-preview" />
                ) : (
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white text-teal-700 ring-1 ring-teal-200">
                    <ScanLine className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-teal-950">
                    {scan.isPending ? "Reading your receipt…" : receipt ? "Receipt attached" : "Have a receipt?"}
                  </p>
                  <p className="text-xs text-teal-800/80" data-testid="scan-receipt-note">
                    {scan.isPending ? "This takes a few seconds." : scanNote ?? "Snap or upload it and we'll fill in the amount, description and date."}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" size="sm" variant="outline" className="border-teal-300 bg-white text-teal-800 hover:bg-teal-100"
                    disabled={scan.isPending} onClick={() => fileRef.current?.click()} data-testid="scan-receipt-button">
                    {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                    {receipt ? "Rescan" : "Scan receipt"}
                  </Button>
                  {receipt && !scan.isPending && (
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove receipt" onClick={() => { setReceipt(null); setScanNote(null); }} data-testid="scan-receipt-remove">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor="exp-desc">Description</Label>
              <Input id="exp-desc" placeholder="Dinner, taxi, rent…" value={description} onChange={(e) => setDescription(e.target.value)} required data-testid="expense-description-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exp-amount">Amount ({group.currency})</Label>
              <Input id="exp-amount" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" className="money" value={amount} onChange={(e) => setAmount(e.target.value)} required data-testid="expense-amount-input" />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_11rem] gap-3">
            <div className="space-y-2">
              <Label>Paid by</Label>
              {memberSelect(paidBy, setPaidBy, "expense-payer-select")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="exp-date">Date</Label>
              <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="money" data-testid="expense-date-input" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Split</Label>
            <div className="grid grid-cols-4 gap-2" role="radiogroup">
              {SPLITS.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={splitType === type}
                  onClick={() => setSplitType(type)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition-[background-color,border-color,color] duration-150",
                    splitType === type ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-200 text-slate-600 hover:bg-slate-50",
                  )}
                  data-testid={`split-type-${type}`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{SPLITS.find((s) => s.type === splitType)?.hint}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="split-details">
            {splitType === "equal" && (
              <div className="space-y-1">
                {group.members.map((m) => {
                  const on = selected.includes(m.id);
                  return (
                    <label key={m.id} className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white">
                      <span className="flex items-center gap-2.5 text-sm font-medium">
                        <Checkbox
                          checked={on}
                          onCheckedChange={(c) => setSelected(c ? [...selected, m.id] : selected.filter((x) => x !== m.id))}
                          data-testid={`equal-member-checkbox-${m.name}`}
                        />
                        {m.name}
                      </span>
                      <span className="money text-sm text-slate-500">{on ? money(perHead, group.currency) : "—"}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {splitType === "exact" && (
              <div className="space-y-2">
                {group.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 px-2">
                    <span className="text-sm font-medium">{m.name}</span>
                    <Input
                      type="number" step="0.01" min="0" placeholder="0.00"
                      className="money h-8 w-28 bg-white text-right"
                      value={exact[m.id] ?? ""}
                      onChange={(e) => setExact({ ...exact, [m.id]: e.target.value })}
                      data-testid={`exact-amount-input-${m.name}`}
                    />
                  </div>
                ))}
                <p className={cn("px-2 pt-1 text-right text-xs font-semibold", Math.abs(remaining) < 0.005 ? "text-green-700" : "text-rose-600")} data-testid="exact-remaining">
                  {Math.abs(remaining) < 0.005 ? "Adds up ✓" : remaining > 0 ? `${money(remaining, group.currency)} left to assign` : `${money(-remaining, group.currency)} over`}
                </p>
              </div>
            )}
            {splitType === "full" && (
              <div className="space-y-2">
                <Label>Who owes the full amount?</Label>
                {memberSelect(fullOwer, setFullOwer, "full-ower-select")}
                <p className="text-xs text-muted-foreground">
                  {nameOf(fullOwer)} owes {nameOf(paidBy)} {money(total, group.currency)}
                </p>
              </div>
            )}
            {splitType === "items" && (
              <ItemSplitEditor items={items} setItems={setItems} members={group.members} total={total} currency={group.currency} />
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mut.isPending || scan.isPending} className="w-full sm:w-auto" data-testid="expense-submit-button">
              {mut.isPending ? "Saving…" : isEdit ? "Save changes" : "Save expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
