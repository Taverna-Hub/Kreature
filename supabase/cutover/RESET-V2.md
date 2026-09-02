# Corte destrutivo para Finance v2

Este procedimento remove todos os usuários e dados atuais. Ele é a **última**
etapa e só pode ser executado depois que a aplicação estiver funcionando
inteiramente sobre a v2 em produção.

## Estado atual

O que já está pronto no repositório:

- Fundação v2 (`catalog`, `app_private`, `api`) com RLS forçada em todas as
  tabelas privadas e FKs compostas por `user_id`.
- Trigger `on_auth_user_created_v2` criando perfil e as 17 categorias padrão,
  além do backfill dos usuários existentes.
- Operações de investimento atômicas; posição, quantidade, preço médio,
  patrimônio e rentabilidade são recalculados a partir das operações.
- Edge Function `finance-v2` e gateway tipado cobrindo todos os contratos.
- Frontend lendo e gravando **somente** pela camada v2
  (`SupabaseFinanceV2Repository`). Nenhum componente acessa `public`.
- Suítes `supabase/tests/finance_v2_integration.sql` e
  `supabase/tests/finance_v2_edge_function.py`.

O schema `public` continua existindo e intocado. Ele não é mais lido nem escrito
pelo frontend, mas guarda os dados de v1 até o corte.

## Pré-requisitos

1. Confirmar PITR/backup do projeto e sua retenção.
2. Confirmar `DATA_ROOT_KEY_ACTIVE_VERSION` e `DATA_ROOT_KEY_V1` em Edge
   Function Secrets; testar uma descriptografia real e a cópia offline.
3. Aplicar as migrations e publicar `finance-v2`.
4. Expor os schemas corretos na Data API. Enquanto o frontend antigo estiver no
   ar, `public` e `api` precisam estar expostos; depois do corte, apenas `api`.
5. Rodar as duas suítes contra o projeto de staging com dois usuários sintéticos.
6. Ativar página de manutenção e desabilitar signup no Dashboard.

## Corte

1. Remover o trigger v1 `on_auth_user_created` (o v2 já está ativo em paralelo).
2. `category-images` fica preservado por decisão do operador, sem as políticas
   legadas de acesso. Caso seja removido no futuro, use a API de Storage ou o
   Dashboard; não execute `DELETE` em `storage.objects`, pois isso é bloqueado
   pelo Supabase para impedir arquivos físicos órfãos.
3. Excluir `auth.users`. Todo o dado privado v1 e v2 cai por cascade — as FKs
   internas de cada tenant foram convertidas para `NO ACTION DEFERRABLE`
   justamente para que essa exclusão consiga acontecer em uma transação.
4. Validar que nenhuma sessão e nenhum registro privado restaram.
5. Aplicar `20260901131000_finance_v2_destructive_cutover.sql`, que remove o
   trigger/políticas v1 e recria `public` vazio e sem acesso público.
6. A migration de corte reduz a Data API a `api`; habilitar signup novamente.

## Rollback

Depois de excluir `auth.users`, rollback só é possível por restauração de
backup/PITR. Não restaure em produção sem reexecutar o reset e revisar os
secrets de criptografia. Backups antigos podem conter dados v1 até o fim da
retenção.
