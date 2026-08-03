/**
 * Edge function: admin-create-user
 *
 * Permite que um admin/gerente da empresa crie um novo usuário sem
 * deslogar a própria sessão. Usa o service-role internamente.
 *
 * Espera JSON:
 *   { email, password, nome, role: 'admin'|'gerente'|'vendedor'|'tecnico'|'user' }
 *
 * Valida (via JWT do chamador) que ele é admin da empresa alvo.
 */
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ROLES = new Set([
  "admin", "gerente", "vendedor", "tecnico", "user",
]);

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // ---- 1) valida chamador ----
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u, error: uErr } = await userClient.auth.getUser();
  if (uErr || !u?.user) return json(401, { error: "Não autenticado" });

  const callerId = u.user.id;
  const admin = createClient(supabaseUrl, serviceRole);

  // company do chamador
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("company_id")
    .eq("id", callerId)
    .maybeSingle();
  const callerCompanyId = (callerProfile as any)?.company_id;
  if (!callerCompanyId) return json(403, { error: "Usuário sem empresa" });

  // chamador precisa ser admin da company
  const { data: callerRoles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId);
  const isAdmin = ((callerRoles as any[]) ?? []).some(
    (r) => r.role === "admin" || r.role === "super_admin",
  );
  if (!isAdmin) return json(403, { error: "Apenas admins podem cadastrar usuários" });

  // ---- 2) parse / valida payload ----
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "JSON inválido" }); }
  const { email, password, nome, role, phone, whatsapp } = body || {};
  if (!email || !password || !nome) return json(400, { error: "Campos obrigatórios: email, password, nome" });
  if (!ALLOWED_ROLES.has(role)) return json(400, { error: "Role inválido" });
  if (String(password).length < 6) return json(400, { error: "Senha deve ter ao menos 6 caracteres" });

  // Sanitiza telefones — só dígitos
  const cleanPhone = phone ? String(phone).replace(/\D+/g, "") || null : null;
  const cleanWhatsapp = whatsapp ? String(whatsapp).replace(/\D+/g, "") || null : null;

  // ---- 3) cria user ----
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome, company_id: callerCompanyId },
  });
  if (createErr || !created?.user) {
    return json(400, { error: createErr?.message || "Erro ao criar usuário" });
  }
  const newId = created.user.id;

  // ---- 4) preenche profile + role na company do chamador ----
  await admin.from("profiles").upsert({
    id: newId,
    email,
    nome,
    company_id: callerCompanyId,
    phone: cleanPhone,
    whatsapp: cleanWhatsapp,
  }, { onConflict: "id" });

  await admin.from("user_roles").upsert(
    { user_id: newId, role, company_id: callerCompanyId },
    { onConflict: "user_id,role,company_id" },
  );

  return json(200, { id: newId, email, nome, role });
});
