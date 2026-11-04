import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiPost } from "@/lib/api";
import { CURRENCIES, errorMessage } from "@/lib/format";
import type { Currency, Group, GroupCreate } from "@/lib/types";
import { useMe } from "@/lib/useMe";

export default function CreateGroupDialog() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [members, setMembers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const reset = () => {
    setName(""); setCurrency("USD"); setDraft("");
    setMembers(me.data ? [me.data.name] : []);
  };

  const mut = useMutation({
    mutationFn: (body: GroupCreate) => apiPost<Group>("/groups", body),
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      toast.success(`Group "${g.name}" created`);
      setOpen(false);
      nav(`/groups/${g.id}`);
    },
    onError: (e) => toast.error(errorMessage(e, "Could not create group")),
  });

  const addMember = () => {
    const n = draft.trim();
    if (!n) return;
    if (members.some((m) => m.toLowerCase() === n.toLowerCase())) return toast.error("Already added");
    setMembers([...members, n]);
    setDraft("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const all = draft.trim() ? [...members, draft.trim()] : members;
    if (all.length < 2) return toast.error("Add at least two people");
    mut.mutate({ name, currency, members: all });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger onClick={reset} render={<Button className="h-11 px-5 font-semibold" data-testid="create-group-btn" />}>
        <Plus className="h-4 w-4" /> New group
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight">New group</DialogTitle>
            <DialogDescription>A trip, a flat, a dinner club — anything you share costs in.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="group-name">Group name</Label>
            <Input id="group-name" placeholder="e.g. Lisbon weekend" value={name} onChange={(e) => setName(e.target.value)} required data-testid="group-name-input" />
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={(v: string) => setCurrency(v as Currency)}>
              <SelectTrigger className="w-full" data-testid="group-currency-select">
                <SelectValue>{(v) => CURRENCIES.find((c) => c.code === v)?.label ?? String(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code} data-testid={`currency-option-${c.code}`}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-name">People</Label>
            <div className="flex gap-2">
              <Input
                id="member-name"
                placeholder="Add a name and press Enter"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } }}
                data-testid="group-member-input"
              />
              <Button type="button" variant="outline" onClick={addMember} data-testid="group-member-add-btn">Add</Button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1" data-testid="group-member-chips">
              {members.map((m) => (
                <span key={m} className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-900">
                  {m}
                  <button type="button" aria-label={`Remove ${m}`} onClick={() => setMembers(members.filter((x) => x !== m))} className="rounded-full p-0.5 hover:bg-teal-100" data-testid={`remove-member-${m}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mut.isPending} className="w-full sm:w-auto" data-testid="create-group-submit">
              {mut.isPending ? "Creating…" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
