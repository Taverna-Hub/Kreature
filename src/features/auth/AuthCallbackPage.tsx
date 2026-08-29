import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getSupabase } from "@/data/supabase/client";

export function AuthCallbackPage() {
  const navigate = useNavigate(); const [message, setMessage] = useState("Confirmando seu acesso…");
  useEffect(() => { let active = true; void (async () => {
    const url = new URL(window.location.href); const code = url.searchParams.get("code"); const next = url.searchParams.get("next") === "/redefinir-senha" ? "/redefinir-senha" : "/resumo";
    if (code) { const { error } = await getSupabase().auth.exchangeCodeForSession(code); if (error) { if (active) setMessage("Não foi possível confirmar este link. Solicite um novo e-mail."); return; } }
    if (!active) return;
    if (next === "/redefinir-senha") { window.location.replace("/redefinir-senha?recovery=1"); return; }
    void navigate({ to: next, replace: true });
  })(); return () => { active = false; }; }, [navigate]);
  return <main className="login-page"><section className="login-card"><div className="login-main"><h1>Acesso seguro</h1><p role="status">{message}</p></div></section></main>;
}
