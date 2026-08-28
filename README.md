<p align="center">
  <img src="./public/favicon.svg" width="92" alt="Logo do Kreature" />
</p>

<h1 align="center">Kreature</h1>

<p align="center">
  <strong>Seu dinheiro, do seu jeito.</strong><br />
  Uma SPA local-first para organizar a vida financeira sem abrir mão de privacidade.
</p>

<p align="center">
  <code>React 19</code> · <code>TypeScript</code> · <code>Vite</code> · <code>IndexedDB</code>
</p>

---

## O que o Kreature faz

- Registra entradas, despesas, transferências e ajustes.
- Organiza instituições, cartões e categorias.
- Acompanha investimentos e sua evolução.
- Planeja lançamentos recorrentes e projeções futuras.
- Importa extratos CSV, XLS/XLSX e PDFs pesquisáveis.
- Permite personalizar o Kreature, moldura, identidade e tema.

## Mapa do produto

| Área | Para quê serve |
| --- | --- |
| **Resumo** | Exibe o saldo, os totais do período e a evolução mensal. |
| **Lançamentos** | Centraliza registros, busca, categorias, cartões e importação de extratos. |
| **Patrimônio** | Reúne instituições financeiras e investimentos. |
| **Planejamento** | Organiza recorrências e antecipa o impacto de lançamentos futuros. |
| **Perfil** | Personaliza o Kreature e escolhe o tema claro, escuro ou do sistema. |

## Como os dados funcionam

```text
Interação na interface
        ↓
Regras do domínio financeiro
        ↓
Repositório local (Dexie + IndexedDB)
        ↓
Dados persistidos neste navegador
```

Cada alteração é processada localmente. O repositório mantém cópias isoladas do estado antes de persistir uma transação, evitando que uma operação com falha deixe dados parciais salvos.

## Privacidade em primeiro lugar

Os dados são guardados no IndexedDB do próprio navegador. O projeto não exige conta, não envia extratos para um servidor e não depende de Open Finance.

As cotações externas são opcionais e qualquer valor pode ser informado manualmente.

## Tecnologias

| Tecnologia | Papel no projeto |
| --- | --- |
| React 19 + TypeScript | Interface e segurança de tipos. |
| Vite | Ambiente de desenvolvimento e build de produção. |
| TanStack Router | Rotas da aplicação. |
| Dexie / IndexedDB | Persistência local no navegador. |
| Recharts | Visualizações do resumo financeiro. |
| Vitest + Testing Library | Testes de regras e componentes. |

## Começar

Pré-requisito: Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Abra o endereço exibido pelo Vite no navegador.

## Comandos

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Inicia o ambiente de desenvolvimento. |
| `npm run lint` | Verifica qualidade e consistência do código. |
| `npm test` | Executa os testes unitários e de interface. |
| `npm run build` | Confere tipos e gera a versão de produção. |
| `npm run preview` | Abre localmente a versão gerada pelo build. |

## Estrutura principal

```text
src/
├── app/       # shell, tema e estilos globais
├── data/      # contexto financeiro e repositório IndexedDB
├── domain/    # regras de lançamentos, cartões, recorrências e investimentos
├── features/  # páginas e recursos do produto
└── shared/    # componentes e hooks reutilizáveis
```

## Convenções de desenvolvimento

- Mantenha regras financeiras em `src/domain`, sem dependência da interface.
- Prefira componentes reutilizáveis em `src/shared` para diálogos, campos e feedbacks.
- Preserve o comportamento local-first: nenhum dado financeiro deve ser enviado sem uma ação explícita do usuário.
- Ao adicionar uma funcionalidade, cubra a regra de domínio ou a interação relevante com um teste.

## Qualidade

Antes de enviar uma alteração, execute:

```bash
npm run lint
npm test
npm run build
```

---

<p align="center">Feito para tornar a rotina financeira mais clara e mais leve.</p>
