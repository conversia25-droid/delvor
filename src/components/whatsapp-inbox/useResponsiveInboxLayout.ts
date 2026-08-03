import { useEffect, useRef, useState } from "react";

const SIDEBAR_WIDTH_STORAGE_KEY = "wa_inbox_sidebar_width";

export function useResponsiveInboxLayout() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const n = raw ? Number(raw) : 450;
    return Number.isFinite(n) ? Math.min(800, Math.max(340, n)) : 450;
  });

  const isResizingSidebarRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWRef = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    if ("addEventListener" in mq) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if ("removeEventListener" in mq) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);

  useEffect(() => { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth)); }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingSidebarRef.current) return;
      const delta = e.clientX - resizeStartXRef.current;
      const next = Math.min(800, Math.max(340, resizeStartWRef.current + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!isResizingSidebarRef.current) return;
      isResizingSidebarRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startResizeSidebar = (e: React.MouseEvent) => {
    isResizingSidebarRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWRef.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return { isMobile, sidebarWidth, startResizeSidebar };
}
