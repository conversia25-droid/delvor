import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* =========================================================
   TIPOS
========================================================= */

interface Tag {
  id: string;
  name: string;
  color: string | null;
  company_id?: string | null;
}

interface LeadTagsBoxProps {
  leadId: string | null;
}

/* =========================================================
   COMPONENTE
========================================================= */

const LeadTagsBox: React.FC<LeadTagsBoxProps> = ({ leadId }) => {
  const { user } = useAuth();
  const companyId = (user as any)?.company_id ?? null;

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [leadTags, setLeadTags] = useState<Tag[]>([]);
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(false);

  const normalizedNewTag = useMemo(() => newTag.trim(), [newTag]);

  /* =========================================================
     LOAD INICIAL / COMPANY CHANGE
  ========================================================= */
  useEffect(() => {
    // Ao trocar de empresa, evita mostrar tags da empresa anterior
    setAllTags([]);
    setLeadTags([]);
    setNewTag("");

    if (companyId) {
      void loadAllTags(companyId);
      if (leadId) void loadLeadTags(leadId, companyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;

    if (leadId) {
      void loadLeadTags(leadId, companyId);
    } else {
      setLeadTags([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, companyId]);

  /* =========================================================
     LOADERS
  ========================================================= */
  async function loadAllTags(cid: string) {
    const { data, error } = await supabase
      .from("tags")
      .select("id,name,color,company_id")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (error) {
      console.error("Erro ao carregar tags:", error);
      setAllTags([]);
      return;
    }

    setAllTags(data || []);
  }

  async function loadLeadTags(lid: string, cid: string) {
    const { data, error } = await supabase
      .from("lead_tags")
      .select("tags ( id, name, color, company_id )")
      .eq("lead_id", lid)
      // garante que só vêm tags da empresa atual
      .eq("tags.company_id", cid);

    if (error) {
      console.error("Erro ao carregar tags do lead:", error);
      setLeadTags([]);
      return;
    }

    const tags = (data || []).map((r: any) => r.tags).filter(Boolean);
    setLeadTags(tags);
  }

  /* =========================================================
     TAG ACTIONS
  ========================================================= */
  async function createOrAttachTag() {
    const name = normalizedNewTag;
    if (!name || !leadId || !companyId) return;

    setNewTag("");
    setLoading(true);

    try {
      // verifica se já existe NA EMPRESA
      const existing = allTags.find(
        (t) => (t.name || "").toLowerCase() === name.toLowerCase()
      );

      if (existing) {
        await attachTag(existing.id);
        return;
      }

      // cria nova (sempre com company_id)
      const { data, error } = await supabase
        .from("tags")
        .insert({ name, company_id: companyId })
        .select("id,name,color,company_id")
        .single();

      if (error || !data) throw error;

      setAllTags((prev) =>
        [...prev, data].sort((a, b) => a.name.localeCompare(b.name))
      );

      await attachTag(data.id);
    } catch (err) {
      console.error("Erro ao criar tag:", err);
      alert("Não foi possível criar a tag.");
    } finally {
      setLoading(false);
    }
  }

  async function attachTag(tagId: string) {
    if (!leadId || !companyId) return;

    // proteção: não deixa anexar tag de outra empresa
    const tag = allTags.find((t) => t.id === tagId);
    if (!tag || (tag.company_id && tag.company_id !== companyId)) return;

    const { error } = await supabase.from("lead_tags").insert({
      lead_id: leadId,
      tag_id: tagId,
    });

    if (error) {
      console.error("Erro ao anexar tag:", error);
    }

    await loadLeadTags(leadId, companyId);
  }

  async function removeTag(tagId: string) {
    if (!leadId) return;

    const { error } = await supabase
      .from("lead_tags")
      .delete()
      .eq("lead_id", leadId)
      .eq("tag_id", tagId);

    if (error) {
      console.error("Erro ao remover tag:", error);
      return;
    }

    setLeadTags((prev) => prev.filter((t) => t.id !== tagId));
  }

  /* =========================================================
     RENDER
  ========================================================= */
  return (
    <div className="flex flex-col gap-2">
      {/* INPUT DE CRIAÇÃO */}
      <div className="flex gap-2">
        <Input
          placeholder={companyId ? "Criar tag e adicionar" : "Selecione uma empresa"}
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && normalizedNewTag) {
              e.preventDefault();
              void createOrAttachTag();
            }
          }}
          disabled={!leadId || loading || !companyId}
        />
        <Button
          variant="outline"
          onClick={() => void createOrAttachTag()}
          disabled={!leadId || loading || !normalizedNewTag || !companyId}
        >
          Criar
        </Button>
      </div>

      {/* TAGS DO LEAD */}
      <div className="flex flex-wrap gap-2">
        {leadTags.length ? (
          leadTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs cursor-pointer hover:bg-muted transition"
              onClick={() => void removeTag(tag.id)}
              title="Clique para remover"
            >
              {tag.name}
              <X className="w-3 h-3 opacity-70" />
            </span>
          ))
        ) : (
          <span className="text-xs opacity-60">Nenhuma tag associada</span>
        )}
      </div>

      {/* TAGS EXISTENTES (SUGESTÕES) */}
      <div className="flex flex-wrap gap-2">
        {allTags
          .filter((t) => !leadTags.some((lt) => lt.id === t.id))
          .slice(0, 10)
          .map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => void attachTag(tag.id)}
              className="inline-flex items-center rounded-full border px-2 py-1 text-xs opacity-70 hover:opacity-100 hover:bg-muted transition"
            >
              + {tag.name}
            </button>
          ))}
      </div>
    </div>
  );
};

export default LeadTagsBox;
