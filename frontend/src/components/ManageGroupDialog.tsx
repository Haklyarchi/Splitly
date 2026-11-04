import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Link2, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiDelete, apiPost } from "@/lib/api";
import { errorMessage, initials } from "@/lib/format";
import type { Group, InviteLink } from "@/lib/types";
import { useMe } from "@/lib/useMe";

export default function ManageGroupDialog({ group }: { group: Group }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const [member, setMember] = useState("");
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const invite = useQuery({
    queryKey: ["group", group.id, "invite"],
    queryFn: () => apiPost<InviteLink>(`/groups/${group.id}/invite`),
    enabled: open,
    staleTime: Infinity,
  });
  const inviteUrl = (memberId?: string) =>
    invite.data ? `${window.location.origin}/join/${invite.data.token}${memberId ? `?m=${memberId}` : ""}` : "";
  const copy = async (url: string, label: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} copied — send it to your friend`);
    } catch {
      window.prompt("Copy this invite link:", url);
    }
  };
  const resetInvite = useMutation({
    mutationFn: () => apiPost<InviteLink>(`/groups/${group.id}/invite/reset`),
    onSuccess: (l) => { qc.setQueryData(["group", group.id, "invite"], l); toast.success("New link created — the old one no longer works"); },
    onError: (e) => toast.error(errorMessage(e, "Could not reset link")),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["group", group.id] });

  const addMember = useMutation({
    mutationFn: () => apiPost<Group>(`/groups/${group.id}/members`, { name: member }),
    onSuccess: () => { toast.success(`${member} added`); setMember(""); refresh(); qc.invalidateQueries({ queryKey: ["groups"] }); },
    onError: (e) => toast.error(errorMessage(e, "Could not add person")),
  });
  const removeMember = useMutation({
    mutationFn: (m: { id: string; name: string }) => apiDelete<Group>(`/groups/${group.id}/members/${m.id}`),
    onSuccess: (_g, m) => { toast.success(`${m.name} removed`); refresh(); qc.invalidateQueries({ queryKey: ["groups"] }); },
    onError: (e) => toast.error(errorMessage(e, "Could not remove person")),
  });
  const claim = useMutation({
    mutationFn: (m: { id: string; name: string }) => apiPost<Group>(`/groups/${group.id}/members/${m.id}/claim`),
    onSuccess: (g) => {
      const mine = g.members.find((x) => x.user_id === me.data?.id);
      toast.success(mine ? `You're now ${mine.name} in this group` : "Unlinked from this group");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Could not link")),
  });
  const share = useMutation({
    mutationFn: () => apiPost<Group>(`/groups/${group.id}/share`, { email }),
    onSuccess: () => { toast.success(`Shared with ${email}`); setEmail(""); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Could not share")),
  });
  const del = useMutation({
    mutationFn: () => apiDelete(`/groups/${group.id}`),
    onSuccess: () => { toast("Group deleted"); qc.invalidateQueries({ queryKey: ["groups"] }); nav("/groups"); },
    onError: (e) => toast.error(errorMessage(e, "Could not delete")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="h-11" data-testid="manage-group-button" />}>
        <Settings2 className="h-4 w-4" /> Manage
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black tracking-tight">Manage group</DialogTitle>
          <DialogDescription>Add people to split with, or give another account access.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm font-medium">People in this group <span className="text-muted-foreground">({group.members.length})</span></p>
          <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200" data-testid="member-list">
            {group.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2" data-testid={`member-row-${m.name}`}>
                <span className="flex items-center gap-2.5 text-sm font-medium">
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-slate-100 text-[10px] font-bold">{initials(m.name)}</span>
                  {m.name}
                  {m.user_id && m.user_id === me.data?.id && (
                    <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" data-testid={`member-you-badge-${m.name}`}>You</span>
                  )}
                  {m.user_id && m.user_id !== me.data?.id && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500" data-testid={`member-linked-badge-${m.name}`}>has account</span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                {!m.user_id && (
                  <Button
                    type="button" size="icon-xs" variant="ghost" aria-label={`Copy invite link for ${m.name}`}
                    className="text-slate-400 hover:bg-teal-50 hover:text-teal-700"
                    disabled={!invite.data}
                    onClick={() => void copy(inviteUrl(m.id), `Invite link for ${m.name}`)}
                    data-testid={`copy-member-invite-${m.name}`}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                {(!m.user_id || m.user_id === me.data?.id) && (
                  <Button
                    type="button" size="xs" variant="ghost"
                    className={m.user_id ? "text-slate-500" : "text-teal-700 hover:bg-teal-50"}
                    disabled={claim.isPending}
                    onClick={() => claim.mutate(m)}
                    data-testid={`claim-member-button-${m.name}`}
                  >
                    {m.user_id ? "Not me" : "That's me"}
                  </Button>
                )}
                <Button
                  type="button" size="icon-xs" variant="ghost" aria-label={`Remove ${m.name}`}
                  className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  disabled={removeMember.isPending || group.members.length <= 1}
                  onClick={() => { if (window.confirm(`Remove ${m.name} from ${group.name}?`)) removeMember.mutate(m); }}
                  data-testid={`remove-member-button-${m.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Tap "That's me" on your name so payments to you wait for your "Got it". People who are part of an expense or settlement can't be removed until those are deleted.</p>
        </div>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (member.trim()) addMember.mutate(); }}>
          <Label htmlFor="add-person">Add a person</Label>
          <div className="flex gap-2">
            <Input id="add-person" placeholder="Name" value={member} onChange={(e) => setMember(e.target.value)} data-testid="add-person-input" />
            <Button type="submit" disabled={addMember.isPending} data-testid="add-person-submit">Add</Button>
          </div>
        </form>
        <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/60 p-3" data-testid="invite-link-section">
          <p className="flex items-center gap-1.5 text-sm font-medium text-teal-950"><Link2 className="h-4 w-4" /> Invite link</p>
          <div className="flex gap-2">
            <Input readOnly value={invite.isPending ? "Creating link…" : inviteUrl()} onFocus={(e) => e.currentTarget.select()}
              className="money h-9 bg-white text-xs" data-testid="invite-link-input" />
            <Button type="button" disabled={!invite.data} onClick={() => void copy(inviteUrl(), "Invite link")} data-testid="copy-invite-link-button">
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-teal-900/80">Friends open it, sign in, pick their name and join. Use the <Link2 className="inline h-3 w-3" /> next to a name to send a link just for that person.</p>
            <button type="button" onClick={() => { if (window.confirm("Make a new link? The current one will stop working.")) resetInvite.mutate(); }}
              disabled={resetInvite.isPending}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800" data-testid="reset-invite-link-button">
              <RefreshCw className="h-3 w-3" /> New link
            </button>
          </div>
        </div>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) share.mutate(); }}>
          <Label htmlFor="share-email">Share with an account</Label>
          <div className="flex gap-2">
            <Input id="share-email" type="email" placeholder="friend@email.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="share-email-input" />
            <Button type="submit" variant="secondary" disabled={share.isPending} data-testid="share-submit">Share</Button>
          </div>
          <p className="text-xs text-muted-foreground">They'll see this group and can add expenses.</p>
        </form>
        {me.data?.id === group.owner_id && (
          <Button
            variant="ghost"
            className="justify-start text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            onClick={() => { if (window.confirm(`Delete "${group.name}" and all its expenses?`)) del.mutate(); }}
            data-testid="delete-group-button"
          >
            <Trash2 className="h-4 w-4" /> Delete group
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
