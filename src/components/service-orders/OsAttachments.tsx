import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, FileText, Loader2, ExternalLink, Eye } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { uploadFile, FILE_ACCEPT } from "@/lib/uploadImage";
import ImageLightbox from "@/components/ImageLightbox";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ServiceOrderAttachment } from "@/types/delvor";

interface OsAttachmentsProps {
  serviceOrderId: string | null;
  /** Bloqueia upload/remoção quando OS está fechada/cancelada. */
  readOnly?: boolean;
}

const KIND_OPTIONS = [
  { value: "foto_entrada",  label: "Foto de entrada" },
  { value: "foto_saida",    label: "Foto de saída" },
  { value: "laudo",         label: "Laudo" },
  { value: "comprovante",   label: "Comprovante" },
  { value: "assinatura",    label: "Assinatura" },
  { value: "outro",         label: "Outro" },
];

function isImage(mime: string | null) {
  return !!mime && mime.startsWith("image/");
}

function bytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export default function OsAttachments({ serviceOrderId, readOnly }: OsAttachmentsProps) {
  const { user } = useAuth();
  const [items, setItems] = useState<ServiceOrderAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadKind, setUploadKind] = useState<string>("foto_entrada");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);

  async function load() {
    if (!serviceOrderId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("service_order_attachments" as any)
      .select("*")
      .eq("service_order_id", serviceOrderId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao listar anexos", description: error.message, variant: "destructive" });
      return;
    }
    setItems((data as any[]) ?? []);
  }

  useEffect(() => { if (serviceOrderId) load(); }, [serviceOrderId]);

  async function handleFile(file: File) {
    if (!serviceOrderId || !user?.company_id) return;
    setUploading(true);
    try {
      const up = await uploadFile(file);
      if (!up.ok) {
        toast({ title: "Erro no upload", description: up.error, variant: "destructive" });
        return;
      }
      const { error: insErr } = await supabase.from("service_order_attachments" as any).insert({
        service_order_id: serviceOrderId,
        file_name: file.name,
        file_url: up.url,
        mime_type: file.type || null,
        size_bytes: file.size,
        kind: uploadKind,
        uploaded_by: user.id,
      });
      if (insErr) throw insErr;

      toast({ title: "Anexo enviado" });
      load();
    } catch (err: any) {
      toast({ title: "Erro ao salvar anexo", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function remove(att: ServiceOrderAttachment) {
    if (!confirm(`Remover "${att.file_name}"?`)) return;
    // O arquivo no MinIO fica órfão (não há webhook de remoção) — apaga só o registro.
    const { error } = await supabase.from("service_order_attachments" as any).delete().eq("id", att.id);
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Anexo removido" });
    load();
  }

  if (!serviceOrderId) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        Salve a OS primeiro para anexar arquivos.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex items-center gap-2">
          <Select value={uploadKind} onValueChange={setUploadKind}>
            <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={FILE_ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.currentTarget.value = "";
            }}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading} size="sm">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
            Anexar
          </Button>
        </div>
      )}

      {loading && <div className="text-xs text-muted-foreground py-3">Carregando...</div>}
      {!loading && items.length === 0 && (
        <div className="text-sm text-muted-foreground py-6 text-center">Nenhum anexo.</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((a) => (
          <div key={a.id} className="rounded-md border bg-card overflow-hidden group">
            {isImage(a.mime_type) ? (
              <button
                type="button"
                onClick={() => setViewer({ url: a.file_url, name: a.file_name })}
                className="block w-full aspect-square bg-muted/30 relative"
                title="Ver imagem"
              >
                <img src={a.file_url} alt={a.file_name} className="h-full w-full object-cover" />
                <div className="absolute top-2 right-2 bg-background/90 rounded p-1 opacity-0 group-hover:opacity-100 transition">
                  <Eye className="h-3 w-3" />
                </div>
              </button>
            ) : (
              <a href={a.file_url} target="_blank" rel="noopener noreferrer" className="block aspect-square bg-muted/30 relative">
                <div className="h-full w-full flex items-center justify-center">
                  <FileText className="h-10 w-10 text-muted-foreground" />
                </div>
                <div className="absolute top-2 right-2 bg-background/90 rounded p-1 opacity-0 group-hover:opacity-100 transition">
                  <ExternalLink className="h-3 w-3" />
                </div>
              </a>
            )}
            <div className="p-2 text-xs">
              <div className="truncate font-medium" title={a.file_name}>{a.file_name}</div>
              <div className="flex justify-between items-center text-muted-foreground mt-1">
                <span className="truncate">{KIND_OPTIONS.find((k) => k.value === a.kind)?.label || a.kind}</span>
                <span>{bytes(a.size_bytes)}</span>
              </div>
              {!readOnly && (
                <Button variant="ghost" size="sm" className="w-full mt-1 h-6 text-rose-500 hover:text-rose-600" onClick={() => remove(a)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Remover
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <ImageLightbox
        src={viewer?.url || null}
        caption={viewer?.name}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}
