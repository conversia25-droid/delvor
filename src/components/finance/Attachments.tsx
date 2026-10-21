/* Anexos do financeiro (boleto, comprovante, nota). Arquivo vai pro bucket
   privado 'finance-files'; abrir gera um link temporário de 2 minutos.
   Idêntico nos dois repos. */
import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_KIND_LABEL, ATTACHMENT_MAX_BYTES, deleteAttachment, listAttachments, openAttachment,
  uploadAttachment, MISSING_DB_MSG, type Attachment, type AttachmentEntity, type AttachmentKind,
} from "@/lib/finance";

function fmtSize(b: number | null) {
  if (!b) return "";
  return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

/** Campo de arquivo pra usar dentro de diálogos (envio acontece depois da ação principal). */
export function AttachFileField({
  id, file, onChange, label = "Anexar arquivo", hint,
}: { id: string; file: File | null; onChange: (f: File | null) => void; label?: string; hint?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <input
        id={id}
        ref={ref}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(file.size)}</span>
          <button type="button" onClick={() => { onChange(null); if (ref.current) ref.current.value = ""; }} className="text-muted-foreground hover:text-foreground" aria-label="Remover arquivo">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()}>
          <Paperclip className="mr-1.5 h-4 w-4" /> {label}
        </Button>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {file && file.size > ATTACHMENT_MAX_BYTES && <p className="text-xs text-red-700 dark:text-red-400">Arquivo maior que 15 MB.</p>}
    </div>
  );
}

/** Lista + envio de anexos de um registro. */
export function AttachmentsPanel({
  entity, entityId, defaultKind = "outro", onChanged,
}: { entity: AttachmentEntity; entityId: string; defaultKind?: AttachmentKind; onChanged?: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [kind, setKind] = useState<AttachmentKind>(defaultKind);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const r = await listAttachments(entity, entityId);
    setMissing(!!r.missing);
    setItems(r.data);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entity, entityId]);

  async function onFile(f: File | null) {
    if (!f || !user?.company_id) return;
    setBusy(true);
    const { error } = await uploadAttachment({ companyId: user.company_id, entity, entityId, kind, file: f });
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (error) { toast({ title: "Não foi possível anexar", description: error, variant: "destructive" }); return; }
    toast({ title: "Arquivo anexado", description: f.name });
    load(); onChanged?.();
  }

  async function remove(a: Attachment) {
    const { error } = await deleteAttachment(a);
    setConfirmId(null);
    if (error) { toast({ title: "Não foi possível excluir", description: error, variant: "destructive" }); return; }
    load(); onChanged?.();
  }

  if (missing) return <p className="text-sm text-muted-foreground">{MISSING_DB_MSG}</p>;

  return (
    <div className="space-y-3">
      {items === null ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">Nenhum arquivo anexado.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              {a.mime_type?.startsWith("image/") ? <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <button type="button" className="min-w-0 flex-1 text-left" onClick={async () => {
                const { error } = await openAttachment(a);
                if (error) toast({ title: "Não foi possível abrir", description: error, variant: "destructive" });
              }}>
                <span className="block truncate font-medium text-primary hover:underline">{a.file_name}</span>
                <span className="block text-xs text-muted-foreground">
                  {ATTACHMENT_KIND_LABEL[a.kind]} · {new Date(a.created_at).toLocaleDateString("pt-BR")} {a.size_bytes ? `· ${fmtSize(a.size_bytes)}` : ""}
                </span>
              </button>
              {confirmId === a.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="destructive" onClick={() => remove(a)}>Excluir</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Manter</Button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmId(a.id)} className="shrink-0 text-muted-foreground hover:text-red-600" aria-label={`Excluir ${a.file_name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          id="attach-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AttachmentKind)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label="Tipo do arquivo"
        >
          {(Object.keys(ATTACHMENT_KIND_LABEL) as AttachmentKind[]).map((k) => (
            <option key={k} value={k}>{ATTACHMENT_KIND_LABEL[k]}</option>
          ))}
        </select>
        <input ref={fileRef} type="file" accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
        <Button type="button" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
          Enviar arquivo
        </Button>
        <span className="text-xs text-muted-foreground">PDF ou imagem, até 15 MB</span>
      </div>
    </div>
  );
}

export function AttachmentsDialog({
  open, onOpenChange, title, subtitle, entity, entityId, defaultKind, onChanged,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; subtitle?: string;
  entity: AttachmentEntity; entityId: string | null; defaultKind?: AttachmentKind; onChanged?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
        </DialogHeader>
        {entityId && <AttachmentsPanel entity={entity} entityId={entityId} defaultKind={defaultKind} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}
