import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { GraduationCap, Plus, Loader2, X } from "lucide-react";

type Student = {
  id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  category_goal: string | null;
  active: boolean;
  created_at: string;
};

const CATS = ["A", "B", "AB", "C", "D", "E"];

export default function Students() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const [rows, setRows] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", cpf: "", phone: "", category_goal: "B" });

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("students" as any)
      .select("id,name,cpf,phone,category_goal,active,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar alunos: " + error.message);
    setRows((data as any) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function save() {
    if (!form.name.trim()) {
      toast.error("Informe o nome do aluno");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("students" as any).insert({
      company_id: companyId,
      name: form.name.trim(),
      cpf: form.cpf || null,
      phone: form.phone || null,
      category_goal: form.category_goal || null,
    } as any);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success("Aluno cadastrado");
    setOpen(false);
    setForm({ name: "", cpf: "", phone: "", category_goal: "B" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-primary" /> Alunos
          </h1>
          <p className="text-sm text-muted-foreground">Cadastro de alunos da auto escola.</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Novo aluno
        </button>
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin inline" /> Carregando…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            Nenhum aluno ainda. Clique em <b>Novo aluno</b> para começar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">CPF</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Telefone</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.cpf || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                        {s.category_goal || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.phone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Novo aluno</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Nome *</label>
                <input
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Nome completo"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">CPF</label>
                  <input
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    value={form.cpf}
                    onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                    placeholder="000.000.000-00"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Categoria</label>
                  <select
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    value={form.category_goal}
                    onChange={(e) => setForm({ ...form, category_goal: e.target.value })}
                  >
                    {CATS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Telefone / WhatsApp</label>
                <input
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="(00) 00000-0000"
                />
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
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
