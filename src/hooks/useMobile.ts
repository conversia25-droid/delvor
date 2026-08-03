import { useEffect, useState } from "react";

export function useMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < breakpoint;
  });

  // Controla se o chat está visível no mobile
  const [showChat, setShowChat] = useState(false);

  /* =====================================================
     MEDIA QUERY
  ===================================================== */

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < breakpoint);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [breakpoint]);

  /* =====================================================
     REGRAS DE COMPORTAMENTO
  ===================================================== */

  // Quando sai do mobile, garante que chat não fique "preso"
  useEffect(() => {
    if (!isMobile) {
      setShowChat(false);
    }
  }, [isMobile]);

  /* =====================================================
     HELPERS
  ===================================================== */

  function openChatMobile() {
    if (isMobile) {
      setShowChat(true);
    }
  }

  function backToListMobile() {
    if (isMobile) {
      setShowChat(false);
    }
  }

  function resetMobileView() {
    setShowChat(false);
  }

  return {
    isMobile,
    showChat,
    setShowChat,

    // helpers
    openChatMobile,
    backToListMobile,
    resetMobileView,
  };
}
