import { useContext } from "react";
import { Sun, Moon, Palette, Check } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "@/components/ui/use-toast";

type ThemeMode = "light" | "dark" | "whatsapp";

const OPTIONS: Array<{ value: ThemeMode; label: string; icon: any; preview: string }> = [
  {
    value: "light",
    label: "Claro",
    icon: Sun,
    preview: "bg-white ring-zinc-200",
  },
  {
    value: "dark",
    label: "Escuro",
    icon: Moon,
    preview: "bg-slate-900 ring-slate-700",
  },
  {
    value: "whatsapp",
    label: "WhatsApp",
    icon: Palette,
    preview: "bg-emerald-900 ring-emerald-700",
  },
];

export default function AppearanceSettings() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  async function pick(t: ThemeMode) {
    setTheme(t);
    if (user?.id) {
      const { error } = await supabase
        .from("profiles" as any)
        .update({ theme: t })
        .eq("id", user.id);
      if (error) {
        toast({ title: "Tema aplicado, mas não foi salvo no perfil", description: error.message });
        return;
      }
    }
    toast({ title: `Tema ${t === "light" ? "claro" : t === "dark" ? "escuro" : "WhatsApp"} aplicado` });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold mb-1">Tema</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Sua preferência fica salva no seu perfil — vale em qualquer dispositivo onde você logar.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = theme === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => pick(o.value)}
                className={`relative rounded-lg border p-4 text-left transition ${
                  active
                    ? "border-blue-500 bg-blue-500/10"
                    : "hover:border-blue-500/50 hover:bg-muted/30"
                }`}
              >
                <div className={`h-16 rounded-md ring-1 ${o.preview} mb-3`} />
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{o.label}</span>
                  {active && <Check className="h-4 w-4 text-blue-400 ml-auto" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
