import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { startLocalSession } from "@/auth/session";

export function LoginPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      startLocalSession(name);
      void navigate({ to: "/resumo" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a sessão.");
    }
  };

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-main">
          <div className="login-brand" aria-label="Kreature">
            <span className="login-mark"><img src="/favicon.svg" alt="" /></span>
            <strong>Kreature</strong>
          </div>
          <span className="eyebrow">Seu espaço financeiro</span>
          <h1 id="login-title">Vamos cuidar do seu dinheiro.</h1>
          <p>Entre com o nome que quer usar. Seus dados continuam somente neste navegador.</p>
          <form onSubmit={submit} noValidate>
            <label htmlFor="local-name">Como podemos te chamar?</label>
            <input
              autoComplete="nickname"
              autoFocus
              id="local-name"
              maxLength={24}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(undefined);
              }}
              placeholder="Seu nome ou apelido"
              value={name}
            />
            {error ? <p className="login-error" role="alert">{error}</p> : null}
            <button className="button primary" type="submit">
              Entrar no Kreature <ArrowRight />
            </button>
          </form>
          <div className="login-notes">
            <span><LockKeyhole /> Sessão só nesta aba</span>
            <span><Sparkles /> Sem senha, sem dados enviados</span>
          </div>
        </div>
        <aside className="login-welcome" aria-hidden="true">
          <div>
            <h2>Seu dinheiro,<br />do seu jeito.</h2>
            <p>Privado e local.</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
