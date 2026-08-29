import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useAuth } from "@/auth/auth-context";

type Mode = "signin" | "signup";

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn, signUp, status } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (status === "authenticated") void navigate({ to: "/resumo", replace: true });
  }, [navigate, status]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setFeedback(undefined);
    setPending(true);
    try {
      if (mode === "signup") {
        if (!displayName.trim()) throw new Error("Informe como você quer ser chamado.");
        await signUp(displayName.trim(), email.trim(), password);
        setFeedback("Conta criada. Confirme seu e-mail para entrar no Kreature.");
      } else {
        await signIn(email.trim(), password);
        await navigate({ to: "/resumo" });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível continuar.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card login-card--auth" aria-labelledby="login-title">
        <div className="login-main">
          <div className="login-brand" aria-label="Kreature">
            <span className="login-mark"><img src="/favicon.svg" alt="" /></span>
            <strong>Kreature</strong>
          </div>
          <span className="eyebrow">Seu espaço financeiro</span>
          <h1 id="login-title">{mode === "signin" ? "Entre no Kreature." : "Crie seu espaço."}</h1>
          <p>{mode === "signin" ? "Acesse seus dados financeiros com segurança." : "Seus dados ficam separados e protegidos na sua conta."}</p>
          <form onSubmit={submit} noValidate>
            {mode === "signup" ? <><label htmlFor="display-name">Como podemos te chamar?</label><input autoComplete="name" id="display-name" maxLength={80} onChange={(event) => setDisplayName(event.target.value)} placeholder="Seu nome ou apelido" value={displayName} /></> : null}
            <label htmlFor="email">E-mail</label>
            <input autoComplete="email" id="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="voce@exemplo.com" required type="email" value={email} />
            <label htmlFor="password">Senha</label>
            <input autoComplete={mode === "signin" ? "current-password" : "new-password"} id="password" minLength={6} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
            {error ? <p className="login-error" role="alert">{error}</p> : null}
            {feedback ? <p className="login-success" role="status">{feedback}</p> : null}
            <Button block loading={pending} type="submit">{pending ? "Aguarde…" : mode === "signin" ? "Entrar no Kreature" : "Criar conta"} <ArrowRight /></Button>
          </form>
          <div className="login-links">
            {mode === "signin" ? <Link to="/redefinir-senha">Esqueci minha senha</Link> : null}
            <Button variant="link" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(undefined); setFeedback(undefined); }}>
              {mode === "signin" ? "Ainda não tenho conta" : "Já tenho uma conta"}
            </Button>
          </div>
        </div>
        <aside className="login-welcome" aria-hidden="true">
          <div className="login-welcome-orbit"><span><Sparkles /></span></div>
          <div className="login-welcome-copy"><span>Seu dinheiro, do seu jeito.</span><strong>Clareza<br />para seguir.</strong></div>
        </aside>
      </section>
    </main>
  );
}
