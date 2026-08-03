import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toDataURL } from "qrcode";
import { Loader2, MonitorPlay } from "lucide-react";

function generateSessionToken() {
  const c = (globalThis as any)?.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `tv_${Date.now()}_${Math.random().toString(16).slice(2)}_${Math.random().toString(16).slice(2)}`;
}

export default function TVLogin() {
  const navigate = useNavigate();
  const [sessionToken] = useState(() => generateSessionToken());
  const [statusText, setStatusText] = useState("Gerando conexão da TV...");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  const qrCodeUrl = useMemo(
    () => `${window.location.origin}/tv/connect?token=${encodeURIComponent(sessionToken)}`,
    [sessionToken]
  );

  useEffect(() => {
    let active = true;

    async function generateQr() {
      try {
        const url = await toDataURL(qrCodeUrl, {
          width: 256,
          margin: 1,
          errorCorrectionLevel: "M",
        });
        if (active) setQrDataUrl(url);
      } catch (err: any) {
        if (active) setErrorText(err?.message || "Falha ao gerar o QR Code.");
      }
    }

    generateQr();
    return () => {
      active = false;
    };
  }, [qrCodeUrl]);

  useEffect(() => {
    let mounted = true;
    const db: any = supabase;
    let pollId: number | null = null;

    async function ensurePairingRow() {
      setStatusText("Preparando QR Code...");
      const { error } = await db.from("tv_pairing_sessions").upsert(
        {
          token: sessionToken,
          created_at: new Date().toISOString(),
          approved_at: null,
          consumed_at: null,
          access_token: null,
          refresh_token: null,
        },
        { onConflict: "token" }
      );

      if (error) {
        throw error;
      }
    }

    async function checkPairing() {
      const { data, error } = await db
        .from("tv_pairing_sessions")
        .select("access_token, refresh_token, approved_at, consumed_at")
        .eq("token", sessionToken)
        .maybeSingle();

      if (error || !data) {
        return;
      }

      if (data.consumed_at) {
        return;
      }

      if (data.approved_at && data.access_token && data.refresh_token) {
        setStatusText("Conexão confirmada. Abrindo wallboard...");

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });

        if (sessionError) {
          setErrorText(`Erro ao autenticar a TV: ${sessionError.message}`);
          return;
        }

        await db
          .from("tv_pairing_sessions")
          .update({ consumed_at: new Date().toISOString() })
          .eq("token", sessionToken);

        if (mounted) {
          navigate("/tv/wallboard", { replace: true });
        }
      }
    }

    async function start() {
      try {
        await ensurePairingRow();
        if (!mounted) return;
        setStatusText("Escaneie com o celular para conectar a TV.");
        pollId = window.setInterval(checkPairing, 2000);
        await checkPairing();
      } catch (err: any) {
        if (!mounted) return;
        setErrorText(err?.message || "Falha ao preparar o pareamento da TV.");
        setStatusText("Não foi possível iniciar a conexão.");
      }
    }

    start();

    return () => {
      mounted = false;
      if (pollId) window.clearInterval(pollId);
    };
  }, [navigate, sessionToken]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4">
      <MonitorPlay className="w-16 h-16 text-indigo-500 mb-6 animate-pulse" />
      <h1 className="text-3xl font-bold mb-2">Conectar Wallboard</h1>
      <p className="text-slate-400 mb-8 max-w-md text-center">
        Escaneie o QR Code com o celular, faça o login no CRM e a TV abrirá o wallboard automaticamente.
      </p>

      <div className="bg-white p-4 rounded-2xl shadow-2xl">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="QR Code para conectar a TV" className="h-64 w-64" />
        ) : (
          <div className="h-64 w-64 flex items-center justify-center text-slate-500">Gerando QR Code...</div>
        )}
      </div>

      <div className="mt-8 flex items-center gap-3 text-sm text-slate-300">
        {!errorText ? <Loader2 className="h-4 w-4 animate-spin text-indigo-400" /> : null}
        <span>{statusText}</span>
      </div>

      {errorText ? (
        <p className="mt-3 max-w-md text-center text-sm text-rose-400">{errorText}</p>
      ) : null}
    </div>
  );
}
