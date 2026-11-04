import { formatDistanceToNow } from "date-fns";
import { History } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Expense } from "@/lib/types";

export default function ExpenseChangeLog({ expense }: { expense: Expense }) {
  const edits = [...expense.edits].reverse();
  if (!expense.updated_at) return null;
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-slate-400 underline decoration-dotted underline-offset-2 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700"
        data-testid="expense-edited-tag"
      >
        edited{edits.length > 1 ? ` ×${edits.length}` : ""}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-0" data-testid="expense-change-log">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <History className="h-4 w-4 text-teal-700" />
          <p className="text-sm font-black tracking-tight">Change log</p>
        </div>
        {edits.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">This expense was edited before change tracking was added.</p>
        ) : (
          <ol className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
            {edits.map((ed, i) => (
              <li key={`${ed.at}-${i}`} className="border-l-2 border-teal-200 pl-3" data-testid="expense-change-entry">
                <ul className="space-y-0.5">
                  {ed.changes.map((c) => (
                    <li key={c} className="text-sm text-slate-800" data-testid="expense-change-line">{c}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-slate-500">
                  edited by <span className="font-semibold text-slate-700">{ed.by_name}</span> ·{" "}
                  {formatDistanceToNow(new Date(ed.at), { addSuffix: true })}
                </p>
              </li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
