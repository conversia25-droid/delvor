import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function useChatUrl() {
  const location = useLocation();
  const navigate = useNavigate();

  const [jidFromUrl, setJidFromUrl] = useState<string | null>(() => {
    const params = new URLSearchParams(location.search);
    return params.get("jid");
  });

  // Mantém jid sincronizado com a URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const jid = params.get("jid");
    setJidFromUrl(jid);
  }, [location.search]);

  function setJidInUrl(jid: string) {
    const params = new URLSearchParams(location.search);
    params.set("jid", jid);
    navigate(
      {
        pathname: location.pathname,
        search: params.toString(),
      },
      { replace: true }
    );
  }

  function clearJidInUrl() {
    navigate(
      {
        pathname: location.pathname,
        search: "",
      },
      { replace: true }
    );
  }

  return {
    jidFromUrl,
    setJidInUrl,
    clearJidInUrl,
  };
}
