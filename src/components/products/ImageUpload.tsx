import { useRef, useState } from "react";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";

import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { uploadImage, IMAGE_ACCEPT } from "@/lib/uploadImage";
import ImageLightbox from "@/components/ImageLightbox";

interface ImageUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  /** Texto auxiliar mostrado quando vazio. */
  placeholder?: string;
  /** Compat com chamadas antigas — ignorados (o upload vai pro MinIO via webhook). */
  bucket?: string;
  folder?: string;
  maxBytes?: number;
}

/**
 * Upload de imagem — envia pro MinIO via webhook do n8n (helper `uploadImage`).
 * Mostra preview, permite trocar ou remover.
 *
 * Em caso de troca, NÃO apaga o arquivo antigo do MinIO (deixa órfão) para
 * não perder histórico — limpeza pode ser feita por job separado.
 */
export default function ImageUpload({
  value,
  onChange,
  placeholder = "Clique para enviar uma imagem",
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    const r = await uploadImage(file);
    setUploading(false);
    if (!r.ok) {
      toast({ title: "Erro no upload", description: r.error, variant: "destructive" });
      return;
    }
    onChange(r.url!);
    toast({ title: "Imagem enviada" });
  }

  function clear() {
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.currentTarget.value = "";
        }}
      />

      {value ? (
        <div className="relative inline-block">
          <img
            src={value}
            alt="Preview"
            onClick={() => setViewing(true)}
            title="Ver imagem"
            className="h-32 w-32 rounded-md object-cover ring-1 ring-border cursor-zoom-in"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
            onClick={clear}
            title="Remover"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex flex-col items-center justify-center h-32 w-32 rounded-md border border-dashed border-border bg-muted/30 hover:bg-muted/50 transition disabled:opacity-50"
        >
          {uploading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-1" />
              <span className="text-xs text-muted-foreground">Enviando...</span>
            </>
          ) : (
            <>
              <ImageIcon className="h-6 w-6 text-muted-foreground mb-1" />
              <span className="text-[10px] text-muted-foreground text-center px-2 leading-tight">
                {placeholder}
              </span>
            </>
          )}
        </button>
      )}

      {value && !uploading && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-3 w-3 mr-1" /> Trocar
        </Button>
      )}

      <ImageLightbox
        src={viewing ? value : null}
        onClose={() => setViewing(false)}
      />
    </div>
  );
}
