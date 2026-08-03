import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response("Unauthorized", { status: 401 })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
      }
    )

    // usuário logado
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return new Response("Unauthorized", { status: 401 })
    }

    // pega company_id
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single()

    if (profileError || !profile?.company_id) {
      return new Response("Company not found", { status: 400 })
    }

    // gera nome automático da instância
    const instanceName = `inst_${crypto.randomUUID().slice(0, 8)}`

    // cria instância na Evolution
    const evoRes = await fetch(
      `${Deno.env.get("EVOLUTION_URL")}/instance/create`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: Deno.env.get("EVOLUTION_API_KEY")!,
        },
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      }
    )

    const evoData = await evoRes.json()

    if (!evoRes.ok) {
      return new Response(JSON.stringify(evoData), { status: 500 })
    }

    // salva no Supabase
    await supabase.from("instancias").insert({
      company_id: profile.company_id,
      name: instanceName,
      evolution_instance: instanceName,
      status: "qr",
    })

    return new Response(
      JSON.stringify({
        instance_name: instanceName,
        qrcode: evoData?.qrcode?.base64 ?? null,
      }),
      { headers: { "Content-Type": "application/json" } }
    )
  } catch (err) {
    console.error(err)
    return new Response("Internal server error", { status: 500 })
  }
})
