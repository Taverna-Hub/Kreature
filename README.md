<p align="center">
  <img src="./public/favicon.svg" width="92" alt="Logo do Kreature" />
</p>

<h1 align="center">Kreature</h1>

<p align="center">
  <strong>Seu dinheiro, do seu jeito.</strong><br />
  Controle financeiro pessoal, privado e multiusuário.
</p>

<p align="center">
  <code>React 19</code> · <code>TypeScript</code> · <code>Vite</code> · <code>Supabase</code>
</p>

---

## O que o Kreature faz

- Registra entradas, despesas, transferências, ajustes e compras no cartão.
- Organiza contas, instituições, categorias e regras locais de classificação.
- Acompanha investimentos, patrimônio e posições importadas.
- Planeja receitas e despesas recorrentes.
- Importa extratos CSV, XLS/XLSX e PDFs com revisão antes de salvar.
- Permite personalizar o Kreature, moldura, identidade e tema.

## Dados e segurança

O Supabase é a única fonte de verdade para perfil e dados financeiros. A autenticação usa Supabase Auth por e-mail e senha; o app nunca manipula ou armazena senhas próprias. Cada registro privado é protegido por Row Level Security e pertence a apenas um usuário.

```text
Interface React
      ↓
Regras de domínio
      ↓
FinanceRepository (Supabase)
      ↓
Supabase Auth + PostgreSQL + Storage privado
```

Saldos são derivados de saldo inicial e lançamentos, não de valores gravados localmente. O armazenamento do navegador é usado pelo SDK oficial apenas para manter a sessão autenticada.

## Começar

Pré-requisito: Node.js 20 ou superior e um projeto Supabase.

```bash
npm install
copy .env.example .env
npx supabase login
npx supabase link --project-ref qpxyjmvsrvkotdugwbhi
npx supabase db push
npm run dev
```

Preencha as variáveis públicas em `.env`. Consulte [docs/supabase.md](./docs/supabase.md) para configurar Auth, redirects, RLS, Storage e gerar os tipos do banco.

## Qualidade

```bash
npm run lint
npm test
npm run build
```

## Estrutura

```text
src/
├── app/             # shell e estilos globais
├── auth/            # contexto do Supabase Auth
├── data/supabase/   # cliente e repositório de produção
├── domain/          # regras financeiras puras
├── features/        # páginas e fluxos
└── shared/          # componentes e hooks reutilizáveis

supabase/migrations/ # schema, RLS, policies e catálogo inicial
```

---

<p align="center">Feito para tornar a rotina financeira mais clara e mais leve.</p>
