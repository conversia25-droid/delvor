import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";

/**
 * Cliente Supabase SEM tipagem de schema.
 *
 * Os tipos gerados em ./types.ts estao defasados (nao incluem products,
 * sales, nem as tabelas do add-on Financeiro). Ate regenerar os tipos,
 * as telas que consultam tabelas/RPCs novas importam este `db` no lugar
 * de `supabase` — mesma instancia, mesma sessao, so sem o autocomplete.
 *
 *   import { db as supabase } from "@/integrations/supabase/untyped";
 */
export const db = supabase as unknown as SupabaseClient<any>;
