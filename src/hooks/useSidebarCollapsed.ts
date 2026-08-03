import { useEffect, useState } from "react";

const KEY = "sidebar:collapsed";
const EVENT_NAME = "sidebar-collapsed-change";

function readInitial(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    // Default = collapsed (icons only). Usuário só vê texto se clicar pra expandir.
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

export function useSidebarCollapsed() {
  const [collapsed, setLocal] = useState<boolean>(readInitial);

  useEffect(() => {
    const sync = () => setLocal(readInitial());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setCollapsed = (v: boolean) => {
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch {}
    setLocal(v);
    window.dispatchEvent(new Event(EVENT_NAME));
  };

  return [collapsed, setCollapsed] as const;
}
