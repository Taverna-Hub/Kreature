# Corte destrutivo para Finance v2

Este procedimento só pode ser executado depois que as migrations v2, a Edge
Function `finance-v2`, o frontend v2 e a suíte de integração estiverem em
produção e aprovados. Ele remove todos os usuários e dados atuais.

## Pré-requisitos

1. Confirmar PITR/backup do projeto e sua retenção.
2. Criar `DATA_ROOT_KEY_ACTIVE_VERSION` e `DATA_ROOT_KEY_V1` em Edge Function
   Secrets; testar uma descriptografia e a cópia offline de recuperação.
3. Aplicar migrations e implantar `finance-v2` sem expor o frontend novo.
4. Executar os testes de RLS, FKs compostas, balanceamento e CRUD com dois
   usuários sintéticos.
5. Ativar página de manutenção e desabilitar signup no Dashboard.

## Corte

1. Trocar o trigger de criação de usuário para `app_private.seed_v2_user`.
2. Remover objetos do bucket `category-images`.
3. Excluir `auth.users`; os dados privados v1 e v2 devem sofrer cascade.
4. Validar que nenhuma sessão e nenhum registro privado restaram.
5. Executar o SQL explícito de remoção do schema v1, em revisão separada.
6. Publicar o frontend v2 e habilitar signup.

## Rollback

Após excluir `auth.users`, rollback só é possível por restauração do backup/PITR.
Não restaure o banco em produção sem reexecutar o reset e revisar os secrets de
criptografia. Backups antigos podem conter dados v1 até a expiração da retenção.
