import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, BadgeCheck, BellRing, Clock, CheckCircle2, ChevronDown, Loader2, Paperclip, PartyPopper, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiPost, apiPut } from "@/lib/api";
import { compressImage } from "@/lib/image";
import ReceiptButton from "@/components/ReceiptButton";
import { errorMessage, money } from "@/lib/format";
import type { Group, GroupSummary, ReceiptIn, ReminderCreate, ReminderOut, Settlement, SettlementCreate, Transfer } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const historyKey = (groupId: string) => `splitly:history-open:${groupId}`;
const transferKey = (t: Transfer) => `${t.from_member}-${t.to_member}`;

export default function SettleUpSummary({ group, summary }: { group: Group; summary?: GroupSummary }) {
  const qc = useQueryClient();
  const [popKey, setPopKey] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(() => localStorage.getItem(historyKey(group.id)) === "1");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const proofRef = useRef<HTMLInputElement>(null);
  const pickProof = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Please pick an image file");
    setPreparing(true);
    try { setProof(await compressImage(file)); } catch { toast.error("Could not read that image"); } finally { setPreparing(false); }
  };
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["group", group.id] });
    qc.invalidateQueries({ queryKey: ["groups"] });
  };

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    localStorage.setItem(historyKey(group.id), next ? "1" : "0");
  };

  const settle = useMutation({
    mutationFn: async (t: Transfer) => {
      const s = await apiPost<Settlement>(`/groups/${group.id}/settlements`, {
        from_member: t.from_member, to_member: t.to_member, amount: t.amount, note: note.trim() || null,
      } satisfies SettlementCreate);
      if (proof) {
        await apiPut(`/groups/${group.id}/settlements/${s.id}/receipt`, { data_url: proof } satisfies ReceiptIn)
          .catch(() => toast.error("Settled, but the receipt photo couldn't be attached"));
      }
      return s;
    },
    onSuccess: (s) => {
      setPopKey(s.id);
      setConfirming(null);
      setNote("");
      setProof(null);
      toast.success(`${nameOf(s.from_member)} paid ${nameOf(s.to_member)} ${money(s.amount, group.currency)}`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Could not settle")),
  });

  const remind = useMutation({
    mutationFn: (t: Transfer) =>
      apiPost<ReminderOut>(`/groups/${group.id}/remind`, {
        from_member: t.from_member, to_member: t.to_member,
      } satisfies ReminderCreate),
    onSuccess: (r, t) => {
      invalidate();
      if (r.notified === 0) toast("No one else has access to this group yet — share it from Manage so they get reminders");
      else toast.success(`Reminder sent: ${t.from_name} owes ${t.to_name} ${money(r.amount, group.currency)}`);
    },
    onError: (e) => { toast.error(errorMessage(e, "Could not send reminder")); invalidate(); },
  });

  const undo = useMutation({
    mutationFn: (id: string) => apiDelete(`/groups/${group.id}/settlements/${id}`),
    onSuccess: () => { toast("Settlement undone"); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Could not undo")),
  });

  const confirm = useMutation({
    mutationFn: (s: Settlement) => apiPost<Settlement>(`/groups/${group.id}/settlements/${s.id}/confirm`),
    onSuccess: (s) => { toast.success(`Confirmed — ${nameOf(s.to_member)} received ${money(s.amount, group.currency)}`); invalidate(); },
    onError: (e) => { toast.error(errorMessage(e, "Could not confirm")); invalidate(); },
  });

  const transfers = summary?.transfers ?? [];
  const settlements = summary?.settlements ?? [];
  const pendingCount = settlements.filter((s) => !s.confirmed_at).length;
  const mine = settlements.filter((s) => s.can_confirm);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]" data-testid="settle-up-card">
      <div className="bg-slate-900 px-6 py-5 text-slate-50">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-300">Settle up</p>
        <h2 className="mt-1 text-xl font-black tracking-tight">Who pays whom</h2>
        <p className="mt-1 text-xs text-slate-400">Simplified to the fewest transfers across all bills.</p>
      </div>
      <div className="space-y-3 p-5">
        {summary && transfers.length === 0 && (
          <div key={popKey ?? "none"} className="animate-settle-pop flex items-center gap-3 rounded-xl bg-green-50 p-4 text-green-900" data-testid="all-settled">
            <PartyPopper className="h-5 w-5" />
            <p className="text-sm font-semibold">Everyone is square. Nothing to settle!</p>
          </div>
        )}
        {transfers.map((t) => {
          const key = transferKey(t);
          const isConfirming = confirming === key;
          const remindedRecently = !!t.last_reminded_at && Date.now() - new Date(t.last_reminded_at).getTime() < DAY_MS;
          return (
            <div key={key} className="animate-rise-in rounded-xl border border-teal-200 bg-teal-50/70 p-4" data-testid="transfer-row">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-teal-950">
                  <span className="truncate" data-testid="transfer-from">{t.from_name}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-teal-600" />
                  <span className="truncate" data-testid="transfer-to">{t.to_name}</span>
                </div>
                <span className="money text-base font-semibold text-teal-950" data-testid="transfer-amount">{money(t.amount, group.currency)}</span>
              </div>
              {isConfirming ? (
                <form
                  className="animate-rise-in mt-3 space-y-2"
                  onSubmit={(e) => { e.preventDefault(); settle.mutate(t); }}
                  data-testid="settle-note-form"
                >
                  <Input
                    autoFocus
                    maxLength={140}
                    placeholder="Add a note (optional) — e.g. paid by bank transfer"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="h-9 bg-white text-sm"
                    data-testid="settle-note-input"
                  />
                  <input
                    ref={proofRef} type="file" accept="image/*" className="hidden"
                    onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) void pickProof(f); }}
                    data-testid="settle-receipt-file-input"
                  />
                  {proof ? (
                    <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-white p-1.5 pr-2" data-testid="settle-receipt-preview">
                      <img src={proof} alt="Payment receipt preview" className="h-10 w-8 rounded object-cover" />
                      <span className="flex-1 text-xs font-medium text-teal-900">Receipt photo will be attached</span>
                      <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove receipt photo" onClick={() => setProof(null)} data-testid="settle-receipt-remove">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => proofRef.current?.click()}
                      disabled={preparing}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800 transition-colors duration-150 hover:text-teal-950 hover:underline"
                      data-testid="settle-attach-receipt-button"
                    >
                      {preparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                      Attach payment receipt (optional)
                    </button>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" className="flex-1" disabled={settle.isPending || preparing} data-testid="confirm-settle-button">
                      <CheckCircle2 className="h-4 w-4" /> {settle.isPending ? "Saving…" : "Confirm settled"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setConfirming(null); setNote(""); setProof(null); }} data-testid="cancel-settle-button">
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm" variant="outline"
                    className="flex-1 border-teal-300 bg-white text-teal-800 hover:bg-teal-100"
                    onClick={() => { setConfirming(key); setNote(""); setProof(null); }}
                    data-testid="mark-settled-button"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Mark as settled
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
                    disabled={remind.isPending || remindedRecently}
                    title={remindedRecently ? `Reminded ${formatDistanceToNow(new Date(t.last_reminded_at!), { addSuffix: true })} — you can remind again after 24 hours` : undefined}
                    onClick={() => remind.mutate(t)}
                    data-testid="remind-button"
                  >
                    <BellRing className="h-4 w-4" /> {remindedRecently ? "Reminded" : "Remind"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {mine.map((s) => (
          <div key={s.id} className="animate-rise-in flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-3" data-testid="confirm-callout">
            <p className="text-sm text-green-950">
              <span className="font-semibold">{nameOf(s.from_member)}</span> says they paid{" "}
              <span className="font-semibold">{nameOf(s.to_member)}</span>{" "}
              <span className="money font-semibold">{money(s.amount, group.currency)}</span>. Received it?
            </p>
            <Button size="sm" className="shrink-0 bg-green-700 hover:bg-green-800" disabled={confirm.isPending}
              onClick={() => confirm.mutate(s)} data-testid="callout-confirm-button">
              <BadgeCheck className="h-4 w-4" /> Got it
            </Button>
          </div>
        ))}

        {settlements.length > 0 && (
          <div className="pt-3">
            <button
              type="button"
              onClick={toggleHistory}
              aria-expanded={showHistory}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 transition-colors duration-150 hover:text-slate-700"
              data-testid="settlement-history-toggle"
            >
              <span>
                Settlement history ({settlements.length})
                {pendingCount > 0 && <span className="ml-2 normal-case tracking-normal text-amber-700" data-testid="settlement-pending-count">· {pendingCount} awaiting confirmation</span>}
              </span>
              <span className="flex items-center gap-1 normal-case tracking-normal">
                {showHistory ? "Hide" : "Show"}
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showHistory ? "rotate-180" : ""}`} />
              </span>
            </button>
            {showHistory && (
              <ul className="animate-rise-in mt-1 divide-y divide-slate-100" data-testid="settlement-history">
                {settlements.map((s) => (
                  <li key={s.id} className="py-2 text-sm" data-testid="settlement-item">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">
                        <span className="font-semibold text-slate-800">{nameOf(s.from_member)}</span> paid{" "}
                        <span className="font-semibold text-slate-800">{nameOf(s.to_member)}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <ReceiptButton
                          path={`/groups/${group.id}/settlements/${s.id}/receipt`}
                          hasReceipt={s.has_receipt}
                          title={`Payment receipt · ${nameOf(s.from_member)} → ${nameOf(s.to_member)}`}
                          invalidateKey={["group", group.id, "summary"]}
                          testid="settlement-"
                        />
                        <span className="money font-semibold">{money(s.amount, group.currency)}</span>
                        <Button size="icon-xs" variant="ghost" aria-label="Undo settlement" onClick={() => undo.mutate(s.id)} data-testid="undo-settlement-button">
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </div>
                    {s.note && (
                      <p className="mt-0.5 text-xs italic text-slate-500" data-testid="settlement-note">“{s.note}”</p>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-2">
                      {s.confirmed_at ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700" data-testid="settlement-confirmed">
                          <BadgeCheck className="h-3.5 w-3.5" /> Confirmed by {s.confirmed_by_name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700" data-testid="settlement-pending">
                          <Clock className="h-3.5 w-3.5" /> Awaiting {nameOf(s.to_member)}'s confirmation
                        </span>
                      )}
                      {s.can_confirm && (
                        <Button size="xs" variant="outline" className="border-green-300 text-green-800 hover:bg-green-50"
                          disabled={confirm.isPending} onClick={() => confirm.mutate(s)} data-testid="confirm-received-button">
                          <BadgeCheck className="h-3.5 w-3.5" /> Got it
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
