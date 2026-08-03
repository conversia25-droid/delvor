import { useEffect, useState } from "react";

export function useUrlJidSync() {
  const getJidFromUrl = () => {
    try {
      return new URLSearchParams(window.location.search).get("jid");
    } catch {
      return null;
    }
  };

  const [jidFromUrl, setJidFromUrlState] = useState<string | null>(() => getJidFromUrl());

  const setJidInUrl = (jid: string | null, mode: "push" | "replace" = "push") => {
    if (!jid) return;
    const url = new URL(window.location.href);
    url.searchParams.set("jid", jid);
    if (mode === "replace") window.history.replaceState({}, "", url.toString());
    else window.history.pushState({}, "", url.toString());
  };

  const clearJidInUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("jid");
    window.history.replaceState({}, "", url.toString());
  };

  useEffect(() => {
    const onPopState = () => setJidFromUrlState(getJidFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return { jidFromUrl, setJidFromUrlState, setJidInUrl, clearJidInUrl };
}
