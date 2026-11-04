import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, Link2Off, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage, initials } from "@/lib/format";
import type { Group, InviteJoin, InvitePreview } from "@/lib/types";
import { useMe } from "@/lib/useMe";
import { cn } from "@/lib/utils";

const NEW = "__new__";

export default function JoinGroup() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const invite = useQuery({ queryKey: ["invite", token], queryFn: () => apiGet<InvitePreview>(`/invites/${token}`), retry: false });
  const data = invite.isError ? undefined : invite.data;

  const preferred = params.get("m");
  const [choice, setChoice] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const mine = data?.members.find((m) => m.mine);
  const available = data?.members.filter((m) => !m.claimed) ?? [];
  const defaultChoice = mine?.id ?? (preferred && available.some((m) => m.id === preferred) ? preferred : null);
  const selected = choice ?? defaultChoice;
  const name = newName ?? me.data?.name ?? "";
  const selectedName = selected === NEW ? name.trim() : data?.members.find((m) => m.id === selected)?.name;

  const join = useMutation({
    mutationFn: () => apiPost<Group>(`/invites/${token}/join`, (selected === NEW ? { new_name: name.trim() } : { member_id: selected }) satisfies InviteJoin),
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["group", g.id] });
      toast.success(`You're in ${g.name} as ${selectedName}`);
      nav(`/groups/${g.id}`);
    },
    onError: (e) => { toast.error(errorMessage(e, "Could not join")); invite.refetch(); },
  });

  if (invite.isError) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center" data-testid="invite-invalid">
        <Link2Off className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-4 text-lg font-bold">Invite link not working</p>
        <p className="mt-1 text-sm text-muted-foreground">{errorMessage(invite.error, "This link is invalid.")}</p>
        <Button className="mt-6" render={<Link to="/groups" />} data-testid="invite-go-groups">Go to my groups</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg animate-rise-in">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <div className="bg-slate-900 px-6 py-6 text-slate-50">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-300">You're invited</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" data-testid="invite-group-name">{data?.group_name ?? "Loading…"}</h1>
          {data && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
              <Users className="h-4 w-4" /> {data.members.length} people · {data.currency}
              {data.invited_by && <> · invited by {data.invited_by}</>}
            </p>
          )}
        </div>
        {data && (
          <div className="space-y-5 p-6">
            {data.already_member && mine && (
              <p className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-900" data-testid="invite-already-member">
                You're already in this group as {mine.name}. You can switch names below or just open it.
              </p>
            )}
            <div>
              <p className="text-sm font-semibold">Which one is you?</p>
              <p className="text-xs text-muted-foreground">Picking your name means payments to you wait for your "Got it".</p>
              <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup">
                {data.members.map((m) => {
                  const active = selected === m.id;
                  return (
                    <button
                      key={m.id} type="button" role="radio" aria-checked={active} disabled={m.claimed}
                      onClick={() => setChoice(m.id)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-[background-color,border-color] duration-150",
                        active ? "border-teal-600 bg-teal-50 text-teal-950" : "border-slate-200 hover:bg-slate-50",
                        m.claimed && "cursor-not-allowed opacity-50 hover:bg-transparent",
                      )}
                      data-testid={`invite-member-option-${m.name}`}
                    >
                      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold", active ? "bg-teal-600 text-white" : "bg-slate-100")}>
                        {active ? <Check className="h-4 w-4" /> : initials(m.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">{m.name}</span>
                        {m.claimed && <span className="block text-[11px] font-medium text-slate-500">already taken</span>}
                        {m.mine && <span className="block text-[11px] font-medium text-teal-700">you</span>}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button" role="radio" aria-checked={selected === NEW} onClick={() => setChoice(NEW)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border border-dashed px-3 py-2.5 text-left text-sm font-semibold transition-[background-color,border-color] duration-150",
                    selected === NEW ? "border-teal-600 bg-teal-50 text-teal-950" : "border-slate-300 text-slate-600 hover:bg-slate-50",
                  )}
                  data-testid="invite-member-option-new"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100"><UserPlus className="h-4 w-4" /></span>
                  I'm not listed
                </button>
              </div>
              {selected === NEW && (
                <Input className="mt-3" placeholder="Your name" value={name} onChange={(e) => setNewName(e.target.value)} maxLength={60} data-testid="invite-new-name-input" />
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              {data.already_member ? (
                <Button variant="ghost" render={<Link to={`/groups/${data.group_id}`} />} data-testid="invite-open-group">Open group</Button>
              ) : <span />}
              <Button
                className="h-11 px-5 font-semibold"
                disabled={!selected || (selected === NEW && !name.trim()) || join.isPending || (selected === mine?.id)}
                onClick={() => join.mutate()}
                data-testid="invite-join-button"
              >
                {join.isPending ? "Joining…" : selectedName ? `Join as ${selectedName}` : "Pick your name"} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
