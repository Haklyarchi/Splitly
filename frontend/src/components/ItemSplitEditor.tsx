import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initials, money } from "@/lib/format";
import type { Currency, Member } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface DraftItem {
  key: string;
  name: string;
  price: string;
  member_ids: string[];
}

let seq = 0;
export const newDraftItem = (name = "", price = "", member_ids: string[] = []): DraftItem => ({
  key: `item-${++seq}`, name, price, member_ids,
});

/** Per-person preview: items split evenly among who had them, extra (tax/tip) shared pro-rata. */
export function previewItemShares(items: DraftItem[], total: number): Record<string, number> {
  const sub: Record<string, number> = {};
  for (const it of items) {
    const p = Number(it.price) || 0;
    if (p <= 0 || !it.member_ids.length) continue;
    for (const m of it.member_ids) sub[m] = (sub[m] ?? 0) + p / it.member_ids.length;
  }
  const itemsTotal = Object.values(sub).reduce((a, b) => a + b, 0);
  if (!itemsTotal) return {};
  return Object.fromEntries(Object.entries(sub).map(([m, v]) => [m, v + ((total - itemsTotal) * v) / itemsTotal]));
}

interface Props {
  items: DraftItem[];
  setItems: (items: DraftItem[]) => void;
  members: Member[];
  total: number;
  currency: Currency;
}

export default function ItemSplitEditor({ items, setItems, members, total, currency }: Props) {
  const update = (key: string, patch: Partial<DraftItem>) =>
    setItems(items.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const toggle = (it: DraftItem, mid: string) =>
    update(it.key, { member_ids: it.member_ids.includes(mid) ? it.member_ids.filter((x) => x !== mid) : [...it.member_ids, mid] });

  const itemsTotal = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const extra = Math.round((total - itemsTotal) * 100) / 100;
  const preview = previewItemShares(items, total);

  return (
    <div className="space-y-3" data-testid="item-split-editor">
      <p className="text-xs text-muted-foreground">Tap the people who had each item. Tax, tip or service is shared in proportion.</p>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={it.key} className="rounded-lg border border-slate-200 bg-white p-2.5" data-testid={`item-row-${i}`}>
            <div className="flex items-center gap-2">
              <Input
                value={it.name} placeholder="Item" onChange={(e) => update(it.key, { name: e.target.value })}
                className="h-8 flex-1 text-sm" data-testid={`item-name-input-${i}`}
              />
              <Input
                type="number" step="0.01" min="0" placeholder="0.00" value={it.price}
                onChange={(e) => update(it.key, { price: e.target.value })}
                className="money h-8 w-24 text-right text-sm" data-testid={`item-price-input-${i}`}
              />
              <Button
                type="button" size="icon-xs" variant="ghost" aria-label="Remove item"
                className="text-slate-400 hover:text-rose-600"
                onClick={() => setItems(items.filter((x) => x.key !== it.key))}
                data-testid={`item-remove-button-${i}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {members.map((m) => {
                const on = it.member_ids.includes(m.id);
                return (
                  <button
                    key={m.id} type="button" aria-pressed={on} onClick={() => toggle(it, m.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition-[background-color,border-color,color] duration-150",
                      on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                    )}
                    data-testid={`item-${i}-member-${m.name}`}
                  >
                    <span className="text-[9px] opacity-80">{initials(m.name)}</span> {m.name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => update(it.key, { member_ids: it.member_ids.length === members.length ? [] : members.map((m) => m.id) })}
                className="px-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700"
                data-testid={`item-${i}-toggle-all`}
              >
                {it.member_ids.length === members.length ? "none" : "everyone"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => setItems([...items, newDraftItem()])} data-testid="add-item-button">
        <Plus className="h-4 w-4" /> Add item
      </Button>
      <div className="space-y-1 border-t border-slate-200 pt-2 text-xs">
        <div className="flex justify-between text-slate-500">
          <span>Items</span><span className="money" data-testid="items-subtotal">{money(itemsTotal, currency)}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>{extra >= 0 ? "Tax, tip & other (shared)" : "Discount (shared)"}</span>
          <span className={cn("money", extra < 0 && "text-green-700")} data-testid="items-extra">{money(extra, currency)}</span>
        </div>
        {Object.keys(preview).length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1" data-testid="items-share-preview">
            {members.filter((m) => preview[m.id]).map((m) => (
              <span key={m.id} className="font-medium text-slate-700">
                {m.name} <span className="money">{money(preview[m.id]!, currency)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
