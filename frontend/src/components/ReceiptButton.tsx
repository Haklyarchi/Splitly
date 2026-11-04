import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageUp, Paperclip, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiDelete, apiPut } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { compressImage } from "@/lib/image";
import type { ReceiptIn } from "@/lib/types";

interface Props {
  /** API path of the receipt resource, e.g. /groups/{g}/expenses/{e}/receipt */
  path: string;
  hasReceipt: boolean;
  title: string;
  invalidateKey: readonly unknown[];
  /** data-testid prefix so expense and settlement receipts stay distinguishable */
  testid?: string;
}

export default function ReceiptButton({ path, hasReceipt, title, invalidateKey, testid = "" }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const url = `/api${path}?v=${version}`;
  const refresh = () => qc.invalidateQueries({ queryKey: invalidateKey });
  const tid = (name: string) => `${testid}${name}`;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith("image/")) throw new Error("not-image");
      const data_url = await compressImage(file);
      return apiPut(path, { data_url } satisfies ReceiptIn);
    },
    onSuccess: () => { toast.success("Receipt attached"); setVersion((v) => v + 1); refresh(); },
    onError: (e) => toast.error(e instanceof Error && e.message === "not-image" ? "Please pick an image file" : errorMessage(e, "Could not upload receipt")),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(path),
    onSuccess: () => { toast("Receipt removed"); setOpen(false); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Could not remove receipt")),
  });

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) upload.mutate(f);
      }}
      data-testid={tid("receipt-file-input")}
    />
  );

  if (!hasReceipt) {
    return (
      <>
        {picker}
        <Button
          size="icon-sm" variant="ghost" aria-label="Attach receipt photo"
          className="text-slate-400 hover:text-teal-700"
          disabled={upload.isPending}
          onClick={() => fileRef.current?.click()}
          data-testid={tid("attach-receipt-button")}
        >
          <Paperclip className={upload.isPending ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {picker}
      <DialogTrigger
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200 transition-colors duration-150 hover:bg-amber-100"
        data-testid={tid("view-receipt-button")}
      >
        <Receipt className="h-3 w-3" /> Receipt
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-black tracking-tight">{title}</DialogTitle>
          <DialogDescription>Everyone in the group can see this photo.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50">
          <img src={url} alt={title} className="mx-auto block max-w-full" data-testid={tid("receipt-image")} />
        </div>
        <div className="flex justify-between gap-2">
          <Button
            variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            disabled={remove.isPending}
            onClick={() => { if (window.confirm("Remove this receipt photo?")) remove.mutate(); }}
            data-testid={tid("remove-receipt-button")}
          >
            <Trash2 className="h-4 w-4" /> Remove
          </Button>
          <Button variant="outline" disabled={upload.isPending} onClick={() => fileRef.current?.click()} data-testid={tid("replace-receipt-button")}>
            <ImageUp className="h-4 w-4" /> {upload.isPending ? "Uploading…" : "Replace photo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
