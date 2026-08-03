/**
 * Barras animadas de waveform pra mostrar durante gravação de áudio.
 * Recebe um array de níveis (0..1) — geralmente 16 barras com valores
 * recentes do AnalyserNode.
 */
export default function RecordingWaveBars({ levels }: { levels: number[] }) {
  return (
    <div className="flex items-end gap-0.5 h-6">
      {Array.from({ length: 16 }).map((_, i) => {
        const v = levels[i] ?? 0.1;
        const h = Math.max(4, Math.min(24, v * 24));
        return (
          <span
            key={i}
            className="w-1 bg-rose-500 rounded-sm transition-[height] duration-100"
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}
