import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verifica autenticação
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autorizado");
    const token = authHeader.replace("Bearer ", "");

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Token inválido");

    // Verifica se é super_admin
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isSuperAdmin = roles?.some((r: any) => r.role === "super_admin");
    if (!isSuperAdmin) throw new Error("Acesso negado: apenas super_admin");

    // Obtém a API key e environment do Asaas
    const [{ data: apiKeySetting }, { data: envSetting }] = await Promise.all([
      supabase.from("master_settings").select("value").eq("key", "asaas_api_key").maybeSingle(),
      supabase.from("master_settings").select("value").eq("key", "asaas_env").maybeSingle(),
    ]);

    const apiKey = (apiKeySetting as any)?.value;
    const env = (envSetting as any)?.value || "sandbox";

    if (!apiKey) throw new Error("Chave Asaas não configurada. Acesse Painel Master > Asaas.");

    const baseUrl =
      env === "production"
        ? "https://api.asaas.com/v3"
        : "https://sandbox.asaas.com/api/v3";

    // Parâmetros do request
    const { method = "GET", path, body } = await req.json();
    if (!path) throw new Error("Parâmetro 'path' é obrigatório");

    const asaasRes = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        access_token: apiKey,
        "Content-Type": "application/json",
        "User-Agent": "InfinityCRM/1.0",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await asaasRes.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: asaasRes.status,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
