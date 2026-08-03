import { forwardRef, useMemo } from "react";
import { Input } from "@/components/ui/input";

/**
 * Input de moeda BR estilo calculadora.
 *
 * Comportamento:
 *  - Sempre exibe o valor formatado (ex: "1.234,56")
 *  - Cada tecla numérica desliza os dígitos pra direita (centavos primeiro)
 *  - Backspace remove o último dígito
 *  - Não precisa se preocupar com cursor, ponto ou vírgula
 *
 * Ex: digitando `1`, `2`, `3` numa entrada vazia → 0,01 → 0,12 → 1,23
 *
 * Aceita paste — extrai só os dígitos do que for colado.
 */
export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: number;
  onChange: (n: number) => void;
}

function toDigits(n: number): string {
  if (!isFinite(n) || n <= 0) return "";
  // Arredonda pra centavo pra não sofrer com float weirdness (ex: 0.1+0.2)
  return Math.round(n * 100).toString();
}

function formatDigits(digits: string): string {
  const num = parseInt(digits || "0", 10) / 100;
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, inputMode = "numeric", ...rest },
  ref,
) {
  const display = useMemo(() => formatDigits(toDigits(value)), [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Extrai só dígitos do input — descarta separadores e letras
    const digits = e.target.value.replace(/\D+/g, "");
    // Cap em 12 dígitos (999.999.999,99 = 9 dígitos int + 2 cents). Mais que
    // isso é digitação acidental — evita explodir o input.
    const capped = digits.slice(0, 12);
    const num = parseInt(capped || "0", 10) / 100;
    onChange(num);
  }

  return (
    <Input
      ref={ref}
      value={display}
      onChange={handleChange}
      inputMode={inputMode}
      {...rest}
    />
  );
});

export default MoneyInput;
