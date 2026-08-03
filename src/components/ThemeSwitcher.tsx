import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Palette, Sun, Moon, MessageCircle } from "lucide-react";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  const themes = [
    { value: 'light' as const, label: 'Claro', icon: Sun, color: 'text-blue-600' },
    { value: 'dark' as const, label: 'Escuro Púrpura', icon: Moon, color: 'text-blue-600' },
    { value: 'whatsapp' as const, label: 'WhatsApp', icon: MessageCircle, color: 'text-green-600' },
  ];

  const currentTheme = themes.find(t => t.value === theme);
  const CurrentIcon = currentTheme?.icon || Palette;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full"
          title="Trocar tema"
        >
          <CurrentIcon className={`h-5 w-5 ${currentTheme?.color || ''}`} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {themes.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onClick={() => setTheme(t.value)}
            className={`flex items-center gap-3 cursor-pointer ${
              theme === t.value ? 'bg-accent' : ''
            }`}
          >
            <t.icon className={`h-4 w-4 ${t.color}`} />
            <span className="flex-1">{t.label}</span>
            {theme === t.value && (
              <div className="h-2 w-2 rounded-full bg-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
