/* Link público do motoqueiro: /entregador?t=<token> (sem login).
   Lista as tarefas dele e deixa marcar saiu / entregue / não deu. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Loader2, RefreshCw, MapPin, Phone, MessageCircle, Truck, PackageOpen, CheckCircle2,
  XCircle, Bike, AlertTriangle, Wallet, Calendar,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import MoneyInput from "@/components/MoneyInput";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/formatters";
import {
  COLLECT_METHODS, KIND_LABEL, courierAction, fetchCourierView, mapsLink, type CourierView,
} from "@/lib/delivery";

type Task = CourierView["tasks"][number];
type Status = "loading" | "ok" | "invalid" | "missing" | "error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAIL_REASONS = ["Cliente ausente", "Endereço não encontrado", "Cliente pediu outro dia", "Recusou"];
const METHOD_LABEL: Record<string, string> = Object.fromEntries(COLLECT_METHODS.map((m) => [m.value, m.label]));

const digits = (s: string | null | undefined) => (s || "").replace(/\D/g, "");
function waNumber(phone: string) {
  const d = digits(phone);
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}
function fmtDay(d: string | null | undefined) {
  if (!d) return null;
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return y && m && day ? `${day}/${m}` : null;
}
function fmtTime(d: string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function isMissingRpc(msg: string) {
  return /could not find|does not exist|schema cache|PGRST202|42883/i.test(msg);
}
function isInvalidToken(msg: string) {
  return /link inválido|invalid input syntax for type uuid/i.test(msg);
}

export default function Entregador() {
  const [params] = useSearchParams();
  const token = (params.get("t") || "").trim();
  const tokenOk = UUID_RE.test(token);

  const [status, setStatus] = useState<Status>(tokenOk ? "loading" : "invalid");
  const [view, setView] = useState<CourierView | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const flashTimer = useRef<number | null>(null);

  /* diálogos */
  const [doneTask, setDoneTask] = useState<Task | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<string>("dinheiro");
  const [receivedBy, setReceivedBy] = useState("");
  const [failTask, setFailTask] = useState<Task | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const showFlash = useCallback((ok: boolean, text: string) => {
    setFlash({ ok, text });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 4000);
  }, []);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  const load = useCallback(async (manual = false) => {
    if (!tokenOk) { setStatus("invalid"); return; }
    if (manual) setRefreshing(true);
    try {
      const { data, error } = await fetchCourierView(token);
      if (error) {
        if (isMissingRpc(error)) setStatus("missing");
        else if (isInvalidToken(error)) setStatus("invalid");
        else setStatus((s) => (s === "ok" ? "ok" : "error"));
        if (manual && !isMissingRpc(error) && !isInvalidToken(error)) showFlash(false, "Sem conexão. Tente de novo.");
        return;
      }
      if (!data) { setStatus("invalid"); setView(null); return; }
      setView(data);
      setStatus("ok");
      setUpdatedAt(new Date());
    } catch {
      setStatus((s) => (s === "ok" ? "ok" : "error"));
      if (manual) showFlash(false, "Sem conexão. Tente de novo.");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [token, tokenOk, showFlash]);

  useEffect(() => {
    load();
    if (!tokenOk) return;
    const iv = window.setInterval(() => load(), 60_000);
    return () => window.clearInterval(iv);
  }, [load, tokenOk]);

  const tasks = view?.tasks || [];
  const open = useMemo(() => tasks.filter((t) => t.stage === "atribuida" || t.stage === "em_rota"), [tasks]);
  const done = useMemo(() => tasks.filter((t) => t.stage === "concluida" || t.stage === "falhou"), [tasks]);

  const totals = useMemo(() => {
    const ok = done.filter((t) => t.stage === "concluida");
    const byMethod: Record<string, number> = {};
    for (const t of ok) {
      const v = Number(t.collected_amount || 0);
      if (v <= 0) continue;
      const k = t.collected_method || "outro";
      byMethod[k] = (byMethod[k] || 0) + v;
    }
    const money = Object.values(byMethod).reduce((a, b) => a + b, 0);
    return {
      entregas: ok.filter((t) => t.kind === "entrega").length,
      coletas: ok.filter((t) => t.kind === "coleta").length,
      falhas: done.length - ok.length,
      byMethod, money,
    };
  }, [done]);

  async function run(task: Task, action: "saiu" | "concluida" | "falhou", extra: Parameters<typeof courierAction>[3], okText: string) {
    setBusyId(task.id);
    try {
      const { error } = await courierAction(token, task.id, action, extra);
      if (error) {
        showFlash(false, isMissingRpc(error) ? "O sistema da loja ainda não foi atualizado." : error);
        if (isInvalidToken(error)) setStatus("invalid");
        return false;
      }
      showFlash(true, okText);
      await load();
      return true;
    } catch {
      showFlash(false, "Sem conexão. Tente de novo.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function openDone(t: Task) {
    setDoneTask(t);
    setAmount(Number(t.collect_amount || 0));
    setMethod("dinheiro");
    setReceivedBy("");
  }
  function openFail(t: Task) {
    setFailTask(t);
    setReason("");
  }

  async function confirmDone() {
    if (!doneTask) return;
    setSaving(true);
    const ok = await run(doneTask, "concluida", {
      collected: amount, method: amount > 0 ? method : null, receivedBy: receivedBy.trim() || null,
    }, doneTask.kind === "coleta" ? "Coleta registrada!" : "Entrega registrada!");
    setSaving(false);
    if (ok) setDoneTask(null);
  }
  async function confirmFail() {
    if (!failTask || !reason.trim()) return;
    setSaving(true);
    const ok = await run(failTask, "falhou", { reason: reason.trim() }, "Registrado. A loja vai ver o motivo.");
    setSaving(false);
    if (ok) setFailTask(null);
  }

  /* ---------- telas de aviso ---------- */
  if (status === "loading") {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-base">Carregando suas tarefas…</p>
        </div>
      </Shell>
    );
  }
  if (status === "invalid" || status === "missing" || status === "error") {
    const msg = status === "invalid"
      ? { title: "Link inválido.", text: "Peça um novo para a loja." }
      : status === "missing"
        ? { title: "Ainda não está pronto.", text: "O sistema da loja está sendo atualizado. Tente mais tarde ou fale com a loja." }
        : { title: "Sem conexão.", text: "Confira a internet e tente de novo." };
    return (
      <Shell>
        <div className="flex flex-col items-center text-center py-20 px-4 gap-4">
          <AlertTriangle className="h-12 w-12 text-amber-500" />
          <div>
            <p className="text-xl font-semibold">{msg.title}</p>
            <p className="text-base text-muted-foreground mt-1">{msg.text}</p>
          </div>
          {status === "error" && (
            <Button size="lg" className="h-12 text-base" onClick={() => { setStatus("loading"); load(); }}>
              <RefreshCw className="h-5 w-5 mr-2" /> Tentar de novo
            </Button>
          )}
        </div>
      </Shell>
    );
  }

  const firstName = (view?.courier?.name || "").split(" ")[0];

  return (
    <Shell>
      {/* topo */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            {view?.company && <p className="text-sm text-muted-foreground truncate">{view.company}</p>}
            <p className="text-xl font-bold truncate">Olá, {firstName || "motoqueiro"}!</p>
          </div>
          <Button variant="outline" size="lg" className="h-12 shrink-0" onClick={() => load(true)} disabled={refreshing} aria-label="Atualizar">
            <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="ml-2">Atualizar</span>
          </Button>
        </div>
      </header>

      {flash && (
        <div
          role="status"
          className={`fixed inset-x-3 bottom-4 z-50 rounded-xl px-4 py-3 text-base font-medium shadow-lg flex items-center gap-2 ${
            flash.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
          }`}
          onClick={() => setFlash(null)}
        >
          {flash.ok ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}
          {flash.text}
        </div>
      )}

      <main className="px-4 py-4 space-y-6 pb-24">
        {/* tarefas abertas */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Para fazer {open.length > 0 && <span className="text-muted-foreground font-normal">({open.length})</span>}
          </h2>
          {open.length === 0 ? (
            <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
              <Bike className="h-10 w-10 mx-auto mb-2 opacity-60" />
              <p className="text-base">Nada para fazer agora.</p>
              <p className="text-sm">Quando a loja mandar, aparece aqui.</p>
            </div>
          ) : (
            open.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                busy={busyId === t.id}
                onLeave={() => run(t, "saiu", {}, "Boa viagem! Marcado como saiu.")}
                onDone={() => openDone(t)}
                onFail={() => openFail(t)}
              />
            ))
          )}
        </section>

        {/* feitas hoje */}
        {done.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Feitas hoje</h2>
            <div className="rounded-xl border bg-card divide-y">
              {done.map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {t.stage === "concluida"
                        ? <CheckCircle2 className="inline h-4 w-4 mr-1 text-emerald-500 align-[-2px]" />
                        : <XCircle className="inline h-4 w-4 mr-1 text-rose-500 align-[-2px]" />}
                      {t.customer_name || "Cliente"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {KIND_LABEL[t.kind]}{t.ref ? ` · ${t.ref}` : ""}{t.done_at ? ` · ${fmtTime(t.done_at)}` : ""}
                      {t.stage === "falhou" && " · Não deu"}
                    </p>
                  </div>
                  {t.stage === "concluida" && Number(t.collected_amount || 0) > 0 && (
                    <div className="text-right shrink-0">
                      <p className="font-semibold">{formatBRL(Number(t.collected_amount))}</p>
                      <p className="text-xs text-muted-foreground">{METHOD_LABEL[t.collected_method || ""] || "Outro"}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* total do dia */}
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <p className="font-semibold flex items-center gap-2"><Wallet className="h-5 w-5" /> Resumo do dia</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Entregas" value={totals.entregas} />
                <Stat label="Coletas" value={totals.coletas} />
                <Stat label="Não deu" value={totals.falhas} />
              </div>
              <div className="border-t pt-3 space-y-1">
                <p className="text-sm text-muted-foreground">Dinheiro em mãos</p>
                {totals.money === 0 ? (
                  <p className="text-base">Nada recebido ainda.</p>
                ) : (
                  <>
                    {Object.entries(totals.byMethod).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-base">
                        <span>{METHOD_LABEL[k] || "Outro"}</span>
                        <span className="font-medium">{formatBRL(v)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-lg font-bold pt-1">
                      <span>Total</span>
                      <span>{formatBRL(totals.money)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {updatedAt && (
          <p className="text-center text-xs text-muted-foreground">
            Atualizado às {updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · atualiza sozinho a cada minuto
          </p>
        )}
      </main>

      {/* entregue / coletado */}
      <Dialog open={!!doneTask} onOpenChange={(o) => { if (!o && !saving) setDoneTask(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{doneTask?.kind === "coleta" ? "Coletado" : "Entregue"}</DialogTitle>
            <DialogDescription>{doneTask?.customer_name || "Cliente"}{doneTask?.ref ? ` · ${doneTask.ref}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ent-valor" className="text-base">Valor recebido (R$)</Label>
              <MoneyInput id="ent-valor" value={amount} onChange={setAmount} className="h-12 text-lg" />
              {Number(doneTask?.collect_amount || 0) > 0 && (
                <p className="text-sm text-muted-foreground">Valor a cobrar: {formatBRL(Number(doneTask?.collect_amount))}</p>
              )}
            </div>
            {amount > 0 && (
              <div className="space-y-1.5">
                <Label className="text-base">Forma de pagamento</Label>
                <div className="grid grid-cols-2 gap-2">
                  {COLLECT_METHODS.map((m) => (
                    <Button
                      key={m.value}
                      type="button"
                      variant={method === m.value ? "default" : "outline"}
                      className="h-12 text-base"
                      onClick={() => setMethod(m.value)}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ent-quem" className="text-base">Quem recebeu</Label>
              <Input id="ent-quem" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Nome (opcional)" className="h-12 text-base" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-12 text-base" onClick={() => setDoneTask(null)} disabled={saving}>Voltar</Button>
            <Button className="h-12 text-base bg-emerald-600 hover:bg-emerald-700 text-white" onClick={confirmDone} disabled={saving}>
              {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* não deu */}
      <Dialog open={!!failTask} onOpenChange={(o) => { if (!o && !saving) setFailTask(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Não deu</DialogTitle>
            <DialogDescription>{failTask?.customer_name || "Cliente"}{failTask?.ref ? ` · ${failTask.ref}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="text-base">O que aconteceu?</Label>
            <div className="grid grid-cols-1 gap-2">
              {FAIL_REASONS.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant={reason === r ? "default" : "outline"}
                  className="h-12 text-base justify-start"
                  onClick={() => setReason(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ou escreva o motivo"
              className="text-base min-h-[80px]"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="h-12 text-base" onClick={() => setFailTask(null)} disabled={saving}>Voltar</Button>
            <Button className="h-12 text-base bg-rose-600 hover:bg-rose-700 text-white" onClick={confirmFail} disabled={saving || !reason.trim()}>
              {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <XCircle className="h-5 w-5 mr-2" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-lg">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 py-2">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function TaskCard({ task: t, busy, onLeave, onDone, onFail }: {
  task: Task; busy: boolean; onLeave: () => void; onDone: () => void; onFail: () => void;
}) {
  const charge = Number(t.collect_amount || 0);
  const phone = digits(t.phone);
  const due = fmtDay(t.due_date);
  const isColeta = t.kind === "coleta";

  return (
    <article className="rounded-xl border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${
            isColeta ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
          }`}>
            {isColeta ? <PackageOpen className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
            {KIND_LABEL[t.kind]}
          </span>
          {t.ref && <span className="text-sm text-muted-foreground truncate">{t.ref}</span>}
        </div>
        {t.stage === "em_rota" && (
          <span className="shrink-0 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 text-xs font-semibold">
            Saiu
          </span>
        )}
      </div>

      <div>
        <p className="text-lg font-semibold leading-tight">{t.customer_name || "Cliente"}</p>
        {due && (
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
            <Calendar className="h-3.5 w-3.5" /> Para {due}
          </p>
        )}
      </div>

      {t.address && (
        <div className="space-y-2">
          <p className="text-base flex items-start gap-2">
            <MapPin className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground" />
            <span>{t.address}</span>
          </p>
          {t.address_notes && <p className="text-sm text-muted-foreground pl-7">{t.address_notes}</p>}
          <Button variant="outline" className="w-full h-12 text-base" asChild>
            <a href={mapsLink(t.address)} target="_blank" rel="noopener noreferrer">
              <MapPin className="h-5 w-5 mr-2" /> Abrir no mapa
            </a>
          </Button>
        </div>
      )}

      {t.items && (
        <p className="text-sm rounded-lg bg-muted/50 px-3 py-2">
          <span className="text-muted-foreground">Itens: </span>{t.items}
        </p>
      )}
      {t.notes && <p className="text-sm text-muted-foreground">Obs.: {t.notes}</p>}

      {charge > 0 && (
        <div className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 px-3 py-2 flex items-center justify-between">
          <span className="text-base font-medium">Cobrar</span>
          <span className="text-2xl font-bold">{formatBRL(charge)}</span>
        </div>
      )}

      {/* contato */}
      {phone && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12 text-base" asChild>
            <a href={`tel:${phone}`}><Phone className="h-5 w-5 mr-2" /> Ligar</a>
          </Button>
          <Button variant="outline" className="h-12 text-base" asChild>
            <a href={`https://wa.me/${waNumber(phone)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-5 w-5 mr-2 text-emerald-500" /> WhatsApp
            </a>
          </Button>
        </div>
      )}

      {/* ações */}
      <div className="space-y-2 pt-1">
        {t.stage === "atribuida" && (
          <Button className="w-full h-14 text-lg" onClick={onLeave} disabled={busy}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Bike className="h-5 w-5 mr-2" />}
            Saí para {isColeta ? "coleta" : "entrega"}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-14 text-lg bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onDone} disabled={busy}>
            <CheckCircle2 className="h-5 w-5 mr-2" /> {isColeta ? "Coletado" : "Entregue"}
          </Button>
          <Button variant="outline" className="h-14 text-lg text-rose-600 border-rose-500/40 hover:text-rose-700" onClick={onFail} disabled={busy}>
            <XCircle className="h-5 w-5 mr-2" /> Não deu
          </Button>
        </div>
      </div>
    </article>
  );
}
