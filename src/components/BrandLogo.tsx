/**
 * Logo do Delvor — versão "ribbon" 3D.
 *
 * Mark:
 *   "d" desenhado como uma fita contínua (bowl + stem em um path só),
 *   com gradiente vertical (claro topo → escuro base) e dois highlights
 *   translúcidos por cima simulando profundidade/reflexo. Drop shadow
 *   via CSS filter (mais compatível que SVG <filter>).
 *
 * Wordmark:
 *   Space Grotesk 700 (via <link> no index.html) com kerning apertado,
 *   gradiente aplicado ao texto pra casar com o mark.
 *
 * IDs dos gradients são únicos por instância (useId) pra evitar colisão
 * quando BrandLogo aparece mais de uma vez na mesma página (bug clássico
 * de SVG defs compartilhando o mesmo ID entre instâncias).
 *
 * Paleta atual: azul (blue-300 → blue-500 → navy). Se for trocar,
 * mexe só nos hex de `PALETTE` abaixo — o resto se atualiza sozinho.
 */
import { useId } from "react";

// ---------------------------------------------------------------------------
// Paleta única — troca por outra família aqui pra mudar toda a marca.
// ---------------------------------------------------------------------------
const PALETTE = {
  light: "#93c5fd",  // blue-300
  mid:   "#3b82f6",  // blue-500
  dark:  "#172554",  // blue-950
  fold:  "#0c1c4a",  // navy escuro (dobra 3D)
  hi:    "#dbeafe",  // blue-100 (highlight)
} as const;

interface Props {
  variant?: "full" | "wordmark" | "mark";
  className?: string;
  size?: number;
}

const FONT = '"Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export default function BrandLogo({
  variant = "full",
  className = "",
  size = 2,
}: Props) {
  const px = size * 16;
  // useId retorna algo tipo ":r0:" — hash único por instância.
  const uid = useId().replace(/:/g, "");
  const bodyId = `dl-body-${uid}`;
  const foldId = `dl-fold-${uid}`;

  const mark = (
    <svg
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        height: px,
        width: px,
        display: "block",
        // Drop shadow via CSS (funciona em qualquer browser sem SVG <filter>)
        filter: "drop-shadow(1px 5px 5px rgba(0,0,0,0.3))",
        overflow: "visible",
      }}
      aria-label="Delvor"
    >
      <defs>
        <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={PALETTE.light} />
          <stop offset="50%"  stopColor={PALETTE.mid} />
          <stop offset="100%" stopColor={PALETTE.dark} />
        </linearGradient>
        <linearGradient id={foldId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor={PALETTE.fold} stopOpacity="0.6" />
          <stop offset="100%" stopColor={PALETTE.fold} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/*
        "d" desenhado como fita contínua — path único com dois sub-paths:
          1) contorno externo do "d" completo (bowl + stem juntos)
          2) recorte interno do bowl (miolo vazado)
      */}
      <path
        fill={`url(#${bodyId})`}
        fillRule="evenodd"
        d="M 88 14
           Q 96 14 96 22
           L 96 68
           Q 96 96 66 96
           Q 30 96 22 66
           Q 16 42 40 30
           Q 60 22 74 34
           L 74 22
           Q 74 14 82 14 Z
           M 78 46
           Q 66 40 54 46
           Q 42 54 44 66
           Q 46 78 60 80
           Q 74 82 78 68 Z"
      />
      {/* Sombra de dobra onde o stem 'passa por trás' do bowl */}
      <path
        fill={`url(#${foldId})`}
        d="M 74 46 L 78 46 L 78 68 L 74 68 Z"
      />

      {/* Highlights (mais claros, opacos) por cima */}
      <path fill={PALETTE.hi} opacity="0.55"
            d="M 76 18 Q 82 14 90 18 L 90 34 L 76 34 Z" />
      <path fill={PALETTE.hi} opacity="0.4"
            d="M 24 60 Q 20 40 42 32 Q 60 26 72 34 L 68 42 Q 52 34 40 40 Q 28 46 28 60 Z" />
    </svg>
  );

  const wordmark = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        lineHeight: 1,
        height: px,
      }}
    >
      <span
        className="lowercase"
        style={{
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: `${size * 0.95}rem`,
          lineHeight: 1,
          letterSpacing: "-0.055em",
          background: `linear-gradient(135deg, ${PALETTE.light} 0%, ${PALETTE.mid} 45%, ${PALETTE.dark} 100%)`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        delvor
      </span>
    </span>
  );

  if (variant === "mark") {
    return (
      <span className={className} style={{ display: "inline-block" }}>
        {mark}
      </span>
    );
  }
  if (variant === "wordmark") {
    return (
      <span className={className} style={{ display: "inline-block" }}>
        {wordmark}
      </span>
    );
  }
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: `${size * 0.35}rem`,
        lineHeight: 1,
      }}
    >
      {mark}
      {wordmark}
    </span>
  );
}
