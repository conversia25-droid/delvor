import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Loader2, Download } from "lucide-react";

interface AudioMessageProps {
  src: string;
  variant?: "sent" | "received";
  onTranscribe?: () => void;
  transcribeLabel?: string;
}

let currentlyPlaying: HTMLAudioElement | null = null;

function isIOSWebKit() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

type AudioFormat = "m4a" | "ogg" | "unknown";

function getFormatFromUrl(url: string): AudioFormat {
  try {
    const [base] = url.split(/(?=[?#])/);
    if (/\.m4a$/i.test(base)) return "m4a";
    if (/\.ogg$/i.test(base) || /\.opus$/i.test(base)) return "ogg";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function replaceExt(url: string, fromExt: RegExp, toExt: string) {
  const [base, tail = ""] = url.split(/(?=[?#])/);
  return base.replace(fromExt, toExt) + tail;
}

async function urlSeemsOk(url: string) {
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (head.ok) return true;
  } catch {}

  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (res.ok) return true;
  } catch {}

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-1" },
      cache: "no-store",
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

// Server-side conversion endpoint URL (VPS com ffmpeg)
const CONVERT_API = import.meta.env.VITE_DOCX_CONVERTER_URL
  ? import.meta.env.VITE_DOCX_CONVERTER_URL.replace("/converter-docx-pdf", "/audio-proxy")
  : "https://converter.zapcompany.com.br/audio-proxy";

export function AudioMessage({ src, variant = "received", onTranscribe, transcribeLabel = "Transcrever" }: AudioMessageProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const [seeking, setSeeking] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const [resolvedSrc, setResolvedSrc] = useState<string>("");

  const isSent = variant === "sent";
  const isiOS = isIOSWebKit();

  const containerClass = isSent
    ? "bg-background/10 text-white border-border/40"
    : "bg-muted/70 text-foreground border-border";

  const subtleTextClass = isSent
    ? "text-white/70"
    : "text-muted-foreground";

  const srcFormat = useMemo(() => getFormatFromUrl(src), [src]);

  const candidates = useMemo(() => {
    if (!src) return { primary: "", altM4A: "", altOGG: "" };

    if (srcFormat === "m4a") {
      return {
        primary: src,
        altM4A: src,
        altOGG: replaceExt(src, /\.m4a$/i, ".ogg"),
      };
    }

    if (srcFormat === "ogg") {
      return {
        primary: src,
        altM4A: replaceExt(src, /\.(ogg|opus)$/i, ".m4a"),
        altOGG: src,
      };
    }

    return { primary: src, altM4A: "", altOGG: "" };
  }, [src, srcFormat]);

  function formatTime(seconds: number) {
    const s = Math.floor(seconds || 0);
    const m = Math.floor(s / 60);
    const r = String(s % 60).padStart(2, "0");
    return `${m}:${r}`;
  }

  useEffect(() => {
    let cancelled = false;

    setPlaying(false);
    setIsLoading(false);
    setHasError(false);
    setProgress(0);
    setDuration(0);
    setResolvedSrc("");

    const resolve = async () => {
      if (!candidates.primary) return;

      if (srcFormat === "m4a") {
        if (!cancelled) setResolvedSrc(candidates.primary);
        return;
      }

      if (srcFormat === "ogg") {
        if (isiOS) {
          // 1. Try .m4a if it exists on storage
          if (candidates.altM4A) {
            const ok = await urlSeemsOk(candidates.altM4A);
            if (!cancelled && ok) {
              setResolvedSrc(candidates.altM4A);
              return;
            }
          }

          // 2. Use server-side conversion API
          if (!cancelled) {
            const convertUrl = `${CONVERT_API}?url=${encodeURIComponent(candidates.primary)}`;
            setResolvedSrc(convertUrl);
          }
          return;
        }

        if (!cancelled) setResolvedSrc(candidates.primary);
        return;
      }

      if (!cancelled) setResolvedSrc(candidates.primary);
    };

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [candidates, srcFormat, isiOS]);

  async function safePlay(audio: HTMLAudioElement) {
    setHasError(false);

    try {
      audio.playbackRate = playbackRate;

      if (audio.readyState === 0) audio.load();

      setIsLoading(true);

      await audio.play();
      setPlaying(true);
      currentlyPlaying = audio;
    } catch {
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error("timeout"));
          }, 5000);

          const onCanPlay = () => {
            cleanup();
            resolve();
          };

          const onError = () => {
            cleanup();
            reject(new Error("error"));
          };

          const cleanup = () => {
            window.clearTimeout(timeout);
            audio.removeEventListener("canplay", onCanPlay);
            audio.removeEventListener("error", onError);
          };

          audio.addEventListener("canplay", onCanPlay, { once: true });
          audio.addEventListener("error", onError, { once: true });

          audio.load();
        });

        await audio.play();
        setPlaying(true);
        currentlyPlaying = audio;
      } catch {
        setHasError(true);
        setPlaying(false);
        currentlyPlaying = null;
      } finally {
        setIsLoading(false);
      }
    }
  }

  function togglePlay() {
    if (!resolvedSrc) {
      setHasError(true);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (currentlyPlaying && currentlyPlaying !== audio) {
      currentlyPlaying.pause();
    }

    if (playing) {
      audio.pause();
      setPlaying(false);
      setIsLoading(false);
      if (currentlyPlaying === audio) currentlyPlaying = null;
      return;
    }

    void safePlay(audio);
  }

  function toggleSpeed() {
    const next = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(next);

    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }

  function onSeek(value: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;

    const time = (value / 100) * duration;
    audio.currentTime = time;
    setProgress(time);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.setAttribute("playsinline", "true");
    // @ts-expect-error - webkit attribute not in TS libdom types
    audio.setAttribute("webkit-playsinline", "true");
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";

    audio.playbackRate = playbackRate;

    const updateDuration = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };

    const onLoaded = () => {
      updateDuration();
      setHasError(false);
    };

    const onTime = () => {
      const t = audio.currentTime;
      if (!seeking) setProgress(Number.isFinite(t) && t >= 0 ? t : 0);
      // Atualizar duração durante a reprodução (fix OGG/Opus que não informa no metadata)
      updateDuration();
    };

    const onEnd = () => {
      updateDuration();
      setPlaying(false);
      setProgress(0);
      setIsLoading(false);
      if (currentlyPlaying === audio) currentlyPlaying = null;
    };

    const onPause = () => {
      setPlaying(false);
      setIsLoading(false);
      if (currentlyPlaying === audio) currentlyPlaying = null;
    };

    const onWaiting = () => setIsLoading(true);
    const onStalled = () => setIsLoading(true);
    const onCanPlay = () => setIsLoading(false);
    const onPlaying = () => setIsLoading(false);

    const onError = () => {
      setHasError(true);
      setIsLoading(false);
      setPlaying(false);
      if (currentlyPlaying === audio) currentlyPlaying = null;
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("pause", onPause);

    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", updateDuration);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("pause", onPause);

      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
    };
  }, [playbackRate, seeking, resolvedSrc]);

  const progressPercent = duration ? Math.min((progress / duration) * 100, 100) : 0;

  const unavailableMsg = "• áudio indisponível";

  return (
    <div
      className={`
        flex items-center gap-3
        max-w-[260px] w-fit
        px-3 py-2
        rounded-xl
        backdrop-blur border
        ${containerClass}
      `}
    >
      <button
        onClick={togglePlay}
        className={`
          w-9 h-9 rounded-full
          flex items-center justify-center
          transition
          shrink-0
          ${
            isSent
              ? "bg-white/15 text-white hover:bg-white/25"
              : "bg-foreground/10 text-foreground hover:bg-foreground/15"
          }
        `}
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
      >
        {isLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : playing ? (
          <Pause size={16} />
        ) : (
          <Play size={16} />
        )}
      </button>

      <div className="flex flex-col gap-1 flex-1 min-w-[90px]">
        <div className="relative h-[8px] w-full bg-white/20 rounded-full overflow-hidden cursor-pointer group">
          <div
            className="absolute h-full bg-white/70 rounded-full pointer-events-none transition-all"
            style={{ width: `${progressPercent}%` }}
          />
          {/* Bolinha indicadora */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white shadow-md pointer-events-none transition-all"
            style={{ left: `calc(${progressPercent}% - 6px)` }}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={progressPercent}
            onMouseDown={() => setSeeking(true)}
            onMouseUp={() => setSeeking(false)}
            onTouchStart={() => setSeeking(true)}
            onTouchEnd={() => setSeeking(false)}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label="Progresso do áudio"
            disabled={!duration}
          />
        </div>

        <div className={`text-[10px] leading-none ${subtleTextClass}`}>
          {formatTime(progress)} / {formatTime(duration)}
          {hasError ? <span className="ml-1 opacity-80">{unavailableMsg}</span> : null}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={toggleSpeed}
          className={`
            text-xs font-semibold
            px-2 py-1 rounded-md
            border transition
            ${
              isSent
                ? "bg-white/10 text-white hover:bg-white/20"
                : "bg-foreground/5 text-foreground hover:bg-foreground/10"
            }
          `}
          aria-label="Alterar velocidade do áudio"
        >
          {playbackRate}x
        </button>

        {resolvedSrc && (
          <a
            href={resolvedSrc}
            download={`audio-${Date.now()}.${srcFormat === "m4a" ? "m4a" : "ogg"}`}
            target="_blank"
            rel="noreferrer"
            className={`
              w-7 h-7 rounded-md
              flex items-center justify-center
              border transition
              ${
                isSent
                  ? "bg-white/10 text-white hover:bg-white/20"
                  : "bg-foreground/5 text-foreground hover:bg-foreground/10"
              }
            `}
            title="Baixar áudio"
            onClick={(e) => {
              e.stopPropagation();
              // Fetch + blob para forçar download real
              e.preventDefault();
              fetch(resolvedSrc)
                .then(r => r.blob())
                .then(blob => {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `audio-${Date.now()}.${srcFormat === "m4a" ? "m4a" : "ogg"}`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                })
                .catch(() => {
                  // Fallback: abrir em nova aba
                  window.open(resolvedSrc, "_blank");
                });
            }}
          >
            <Download size={13} />
          </a>
        )}
      </div>

      {onTranscribe && (
        <button
          type="button"
          onClick={onTranscribe}
          style={{ color: "#000" }}
          className={`
            text-xs font-semibold
            px-2 py-1 rounded-md
            border transition
            bg-white/80 !text-black hover:bg-white
          `}
          title="Transcrever áudio"
        >
          {transcribeLabel}
        </button>
      )}

      {resolvedSrc ? <audio ref={audioRef} src={resolvedSrc} preload="metadata" playsInline /> : null}
    </div>
  );
}
