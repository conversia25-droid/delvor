import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useMySenderName(user: any) {
  const [myProfileNome, setMyProfileNome] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const loadMyProfileName = async () => {
      try {
        const uid = user?.id;
        if (!uid) return;
        const { data, error } = await supabase.from("profiles").select("nome").eq("id", uid).maybeSingle();
        if (!cancelled && !error && data?.nome) setMyProfileNome(String(data.nome));
      } catch {}
    };
    void loadMyProfileName();
    return () => { cancelled = true; };
  }, [user?.id]);

  const mySenderName = useMemo(() => {
    return myProfileNome || user?.user_metadata?.nome || user?.user_metadata?.name || user?.user_metadata?.full_name || user?.user_metadata?.user_name || "Atendente";
  }, [myProfileNome, user]);

  return { myProfileNome, mySenderName };
}
