import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, BellRing, CheckCheck, HandCoins, Receipt, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiGet, apiPost } from "@/lib/api";
import type { Notification, NotificationList } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function NotificationBell() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<NotificationList>("/notifications"),
    refetchInterval: 15_000,
  });
  const data = q.isError ? undefined : q.data;
  const unread = data?.unread_count ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  const readAll = useMutation({ mutationFn: () => apiPost("/notifications/read-all"), onSuccess: refresh });
  const readOne = useMutation({ mutationFn: (id: string) => apiPost(`/notifications/${id}/read`), onSuccess: refresh });

  const openItem = (n: Notification) => {
    if (!n.read) readOne.mutate(n.id);
    qc.invalidateQueries({ queryKey: ["group", n.group_id] });
    setOpen(false);
    nav(`/groups/${n.group_id}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" aria-label="Notifications" className="relative" data-testid="notification-bell" />}
      >
        <Bell className={cn("h-5 w-5 transition-transform duration-200", unread > 0 && "origin-top animate-[bell-ring_1.2s_ease-in-out_1]")} />
        {unread > 0 && (
          <span
            className="money absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white"
            data-testid="notification-unread-count"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[22rem] p-0" data-testid="notification-panel">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-black tracking-tight">Notifications</p>
          <Button
            variant="ghost" size="xs" disabled={unread === 0 || readAll.isPending}
            onClick={() => readAll.mutate()} data-testid="notification-mark-all-read"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto" data-testid="notification-list">
          {(data?.items ?? []).length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground" data-testid="notification-empty">
              You're all caught up.
            </li>
          )}
          {data?.items.map((n) => {
            const Icon = n.kind === "expense" ? Receipt : n.kind === "reminder" ? BellRing : n.kind === "member" ? UserPlus : HandCoins;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-50",
                    !n.read && "bg-teal-50/60",
                  )}
                  data-testid="notification-item"
                >
                  <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", n.kind === "expense" || n.kind === "member" ? "bg-slate-900 text-teal-300" : n.kind === "reminder" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800")}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug text-slate-800" data-testid="notification-message">{n.message}</span>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {n.group_name} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </span>
                  </span>
                  {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-teal-600" data-testid="notification-unread-dot" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
