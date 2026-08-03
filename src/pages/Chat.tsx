import { useEffect, useState } from "react";
import WhatsAppInbox from "@/components/WhatsAppInbox";

const STORAGE_KEY_LITE = "inbox:show-lite";
const STORAGE_KEY_API = "inbox:show-api";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1";
  } catch {
    return fallback;
  }
}

const Chat = () => {
  const [showLite, setShowLite] = useState<boolean>(() => readBool(STORAGE_KEY_LITE, true));
  const [showApi] = useState<boolean>(() => readBool(STORAGE_KEY_API, false));

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_LITE, showLite ? "1" : "0"); } catch {}
  }, [showLite]);

  return (
    <div className="flex flex-col h-full w-full">
      <WhatsAppInbox showLite={showLite} showApi={showApi} />
    </div>
  );
};

export default Chat;
