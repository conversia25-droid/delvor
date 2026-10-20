import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ClipboardList, Loader2, Plus, X } from "lucide-react";

type EnrollmentStatus =
  | "matriculado" | "aulas_teoricas" | "prova_teorica"
  | "aulas_praticas" | "prova_pratica" | "aprovado" | "reprovado" | "cancelado";

type Enrollment = {
  id: string;
  number: number;
  category: string;
  status: EnrollmentStatus;
  required_theory_hours: number | null;
  required_practice_hours: number | null;
  completed_theory_hours: number;
  completed_practice_hours: number;
  students: { name: string } | null;
};

type StudentOpt = { id: string; name: string; category_goal: string | null };

const COLUMNS: { key: EnrollmentStatus; label: string; stripe: string }[] = [
  { key: "matriculado",    label: "Matriculado",    stripe: "#8a93a6" },
  { key: "aulas_teoricas", label: "Aulas teóricas", stripe: "#c9760a" },
  { key: "prova_teorica",  label: "Prova teórica",  stripe: "#c9760a" },
  { key: "aulas_praticas", label: "Aulas práticas", stripe: "#1b57d6" },
  { key: "prova_pratica",  label: "Prova prática",  stripe: "#1b57d6" },
  { key: "aprovado",       label: "Aprovado (CNH)", stripe: "#16a34a" },
];

export default function Enrollments() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [form, setForm] = useState({ student_id: "", category: "B" });

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("enrollments" as any)
      .select("id,number,category,status,required_theory_hours,required_practice_hours,completed_theory_hours,completed_practice_hours,students(name)")
      .eq("company_id", companyId)
      .order("number", { ascending: false });
    if (error) toast.error("Erro ao carregar matrículas: " + error.message);
    setRows((data as any) || []);
    setLoading(false);
  }

  async function loadStudents() {
    if (!companyId) return;
    const { data } = await supabase
      .from("students" as any)
      .select("id,name,category_goal")
      .eq("company_id", companyId)
      .eq("active", true)
      .order("name");
    setStudents((data as any) || []);
  }

  useEffect(() => {
    load();
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const grouped = useMemo(() => {
    const g: Record<string, Enrollment[]> = {};
    COLUMNS.forEach((c) => (g[c.key] = []));
    rows.forEach((r) => {
      if (!g[r.status]) g[r.status] = [];
      g[r.status].push(r);
    });
    return g;
  }, [rows]);

  async function move(id: string, status: EnrollmentStatus) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    const { error } = await supabase.from("enrollments" as any).update({ status }).eq("id", id);
    if (error) {
      toast.error("Erro ao mover: " + error.message);
      setRows(prev);
    }
  }

  async function save() {
    if (!form.student_id) {
      toast.error("Escolha o aluno");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("enrollments" as any).insert({
      company_id: companyId,
      student_id: form.student_id,
      category: form.category,
      status: "matriculado",
    } as any);
    setSaving(false);
    if (error) {
      toast.error("Erro ao criar matrícula: " + error.message);
      return;
    }
    toast.success("Matrícula criada");
    setOpen(false);
    setForm({ student_id: "", category: "B" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" /> Matrículas
          </h1>
          <p className="text-sm text-muted-foreground">
            Funil de progresso dos alunos — arraste pelo status conforme avançam.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Nova matrícula
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline" /> Carregando…
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-3">
          {COLUMNS.map((col) => {
            const items = grouped[col.key] || [];
            return (
              <div key={col.key} className="flex w-[270px] flex-none flex-col rounded-xl border bg-muted/30">
                <div className="flex items-center gap-2 px-3 py-3">
                  <span className="h-4 w-1 rounded" style={{ background: col.stripe }} />
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span className="ml-auto rounded-full border bg-card px-2 text-xs font-bold text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 px-2.5 pb-3">
                  {items.map((e) => {
                    const isPractice = ["aulas_praticas", "prova_pratica"].includes(e.status);
                    const done = isPractice ? e.completed_practice_hours : e.completed_theory_hours;
                    const total = isPractice ? e.required_practice_hours || 20 : e.required_theory_hours || 45;
                    const pct = Math.min(100, Math.round((done / total) * 100));
                    return (
                      <div key={e.id} className="rounded-lg border bg-card p-3 shadow-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{e.students?.name || "Aluno"}</span>
                          <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">
                            {e.category}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">MAT-{e.number}</div>
                        {e.status !== "aprovado" && (
                          <div className="mt-2">
                            <div className="flex justify-between text-[11px] text-muted-foreground">
                              <span>{isPractice ? "Práticas" : "Teóricas"}</span>
                              <span>{done}/{total}h</span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, pct)}%` }} />
                            </div>
                          </div>
                        )}
                        <select
                          className="mt-3 w-full rounded-md border bg-background px-2 py-1 text-xs outline-none"
                          value={e.status}
                          onChange={(ev) => move(e.id, ev.target.value as EnrollmentStatus)}
                        >
                          {COLUMNS.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  {items.length === 0 && (
                    <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                      vazio
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Nova matrícula</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Aluno *</label>
                <select
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  value={form.student_id}
                  onChange={(e) => setForm({ ...form, student_id: e.target.value })}
                >
                  <option value="">Selecione…</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {students.length === 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">Cadastre um aluno primeiro em “Alunos”.</p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Categoria</label>
                <select
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {["A", "B", "AB", "C", "D", "E"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Criar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
