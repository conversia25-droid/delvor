import { Input } from "@/components/ui/input";
import { maskPhone } from "@/lib/formatters";

/**
 * Input de telefone com prefixo de país (🇧🇷 +55) colado à esquerda.
 *
 * Hoje só BR — o produto é Brasil-only e a lógica do WhatsApp
 * (JID = 55 + DDD + número) assume isso. O prefixo é estático
 * e serve pra deixar o DDI visível no formulário.
 *
 * O valor guardado continua sendo só os dígitos formatados em padrão BR
 * `(DDD) NNNNN-NNNN` — sem o DDI, igual estava antes.
 */
interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Permite override do id do <input> pra ligar com <Label htmlFor>. */
  id?: string;
}

export default function PhoneInput({
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: PhoneInputProps) {
  return (
    <div className="flex items-stretch">
      <span
        className="inline-flex items-center gap-1 px-2.5 rounded-l-md border border-r-0 border-input bg-muted/40 text-sm font-medium text-muted-foreground shrink-0 whitespace-nowrap select-none"
        aria-label="País: Brasil"
        title="Brasil (+55)"
      >
        <span aria-hidden>🇧🇷</span>
        <span>+55</span>
      </span>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(maskPhone(e.target.value))}
        placeholder={placeholder || "(11) 90000-0000"}
        disabled={disabled}
        className="rounded-l-none flex-1"
        inputMode="tel"
        autoComplete="tel"
      />
    </div>
  );
}
