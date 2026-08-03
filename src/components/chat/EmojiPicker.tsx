import { ScrollArea } from "@/components/ui/scroll-area";

const EMOJI_CATEGORIES: Array<{ title: string; emojis: string[] }> = [
  {
    title: "Frequentes",
    emojis: ["👍","❤️","😂","🙏","👏","🔥","💯","✅","❌","⚠️","💰","📞","📧","📅","🎉","👀"],
  },
  {
    title: "Rostos",
    emojis: ["😀","😃","😄","😁","😆","🥰","😊","😎","🤔","😅","😉","😘","🤩","🥳","😏","😒","😔","😢","😭","😡","🤬","🤯","😱","🥺","😴","🤤","😷","🤒","🤕"],
  },
  {
    title: "Gestos",
    emojis: ["👍","👎","👌","✌️","🤞","🤟","🤘","🫶","👋","🤝","🙌","👏","🙏","✍️","💪","🦾","🦵","🧠","👀","👁️","👅","👄","💋"],
  },
  {
    title: "Objetos",
    emojis: ["💼","💻","📱","⌨️","🖥️","🖨️","🖱️","🖲️","💽","💾","💿","📀","🧮","🎥","📷","📞","☎️","📠","📟","📺","🪛","🔧","⚙️","🛠️","🧰","🔌","🔋"],
  },
  {
    title: "Atividade",
    emojis: ["⚽","🏀","🏈","⚾","🎾","🏐","🎱","🏓","🏸","🥊","🥋","⛳","🎯","🎮","🎲","🎰","🎳","🏆","🥇","🥈","🥉","🎁","🎈","🎉","🎊","🎂","🍕","🍔"],
  },
  {
    title: "Símbolos",
    emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈","✅","❌","❗","❓","‼️","⁉️","💯","🆗","🆕","🆒"],
  },
];

interface Props {
  onSelect: (emoji: string) => void;
}

export default function EmojiPicker({ onSelect }: Props) {
  return (
    <div className="w-80 h-80 flex flex-col">
      <div className="bg-muted px-3 py-2 border-b text-xs font-semibold">Emojis</div>
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {EMOJI_CATEGORIES.map((cat, i) => (
            <div key={i}>
              <h4 className="text-[10px] font-medium text-muted-foreground mb-1 ml-1 uppercase tracking-wider">
                {cat.title}
              </h4>
              <div className="grid grid-cols-8 gap-1">
                {cat.emojis.map((e, j) => (
                  <button
                    key={`${e}-${j}`}
                    type="button"
                    className="h-8 w-8 rounded hover:bg-muted transition flex items-center justify-center text-[18px] hover:scale-110"
                    onClick={() => onSelect(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
