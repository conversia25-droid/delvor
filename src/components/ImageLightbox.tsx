import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface ImageLightboxProps {
  /** URL da imagem a exibir. Quando null, o visualizador fica fechado. */
  src: string | null;
  onClose: () => void;
  /** Nome do arquivo (mostrado como legenda, opcional). */
  caption?: string;
}

/**
 * Visualizador de imagem — abre a imagem em tamanho grande num overlay,
 * dentro da própria página, sem baixar o arquivo.
 *
 * Como usa <img>, a imagem é sempre renderizada (independe de o servidor
 * mandar Content-Disposition de download).
 */
export default function ImageLightbox({ src, onClose, caption }: ImageLightboxProps) {
  return (
    <Dialog open={!!src} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl border-zinc-800 bg-zinc-950 p-3">
        <DialogTitle className="sr-only">Visualizar imagem</DialogTitle>
        {src && (
          <div className="space-y-2">
            <img
              src={src}
              alt={caption || "Imagem"}
              className="mx-auto max-h-[80vh] w-auto rounded object-contain"
            />
            {caption && (
              <p className="text-center text-xs text-zinc-400 truncate">{caption}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
