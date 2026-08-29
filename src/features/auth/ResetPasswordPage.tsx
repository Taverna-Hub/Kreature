import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useAuth } from "@/auth/auth-context";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { sendPasswordReset, updatePassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState(() => new URLSearchParams(window.location.search).get("recovery") === "1");
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(undefined); setFeedback(undefined); setPending(true);
    try {
      if (recovery) { await updatePassword(password); setFeedback("Senha atualizada."); await navigate({ to: "/resumo" }); }
      else { await sendPasswordReset(email.trim()); setFeedback("Se houver uma conta com este e-mail, enviaremos o link de recuperação."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível continuar."); }
    finally { setPending(false); }
  };
  return <main className="login-page"><section className="login-card" aria-labelledby="reset-title"><div className="login-main"><div className="login-brand"><span className="login-mark"><img src="/favicon.svg" alt="" /></span><strong>Kreature</strong></div><span className="eyebrow">Acesso seguro</span><h1 id="reset-title">Recuperar senha</h1><p>{recovery ? "Escolha uma nova senha para sua conta." : "Vamos enviar um link seguro para seu e-mail."}</p><form onSubmit={submit}>{recovery ? <><label htmlFor="new-password">Nova senha</label><input autoComplete="new-password" id="new-password" minLength={6} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></> : <><label htmlFor="reset-email">E-mail</label><input autoComplete="email" id="reset-email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></>}{error ? <p className="login-error" role="alert">{error}</p> : null}{feedback ? <p className="login-success" role="status">{feedback}</p> : null}<Button block loading={pending} type="submit">{pending ? "Aguarde…" : recovery ? "Salvar nova senha" : "Enviar link"} <ArrowRight /></Button></form><div className="login-links"><Link to="/login">Voltar para entrar</Link><Button variant="link" onClick={() => setRecovery((value) => !value)}>{recovery ? "Enviar outro link" : "Já estou com o link"}</Button></div></div></section></main>;
}
