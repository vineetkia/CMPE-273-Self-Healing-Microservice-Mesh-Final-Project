import { useState, useEffect, useCallback } from "react";

/* useRoute — minimal hash-based router. No dependency on react-router.
   Routes:  #/landing  #/login  #/register  #/dashboard  #/profile
   Anything else falls back to landing (or dashboard if authed). */
const ROUTES = ["landing", "login", "register", "dashboard", "profile"];

function parse() {
  const h = (window.location.hash || "").replace(/^#\/?/, "");
  const route = h.split("?")[0] || "";
  return ROUTES.includes(route) ? route : "";
}

export function useRoute() {
  const [route, setRoute] = useState(parse());

  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((next) => {
    if (!ROUTES.includes(next)) next = "landing";
    if (window.location.hash !== `#/${next}`) {
      window.location.hash = `#/${next}`;
    } else {
      // already there; force re-parse anyway
      setRoute(next);
    }
  }, []);

  return { route, navigate };
}
