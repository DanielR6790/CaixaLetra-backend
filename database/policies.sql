-- =====================================================================
-- policies.sql  |  SEGURANÇA (RLS: Row Level Security)
-- Execute DEPOIS do schema.sql.
-- Regra geral: cada usuário só enxerga e altera os PRÓPRIOS dados.
-- =====================================================================

-- Ativa o RLS em todas as tabelas
alter table public.profiles          enable row level security;
alter table public.categories        enable row level security;
alter table public.contents          enable row level security;
alter table public.reviews           enable row level security;
alter table public.projects          enable row level security;
alter table public.board_elements    enable row level security;
alter table public.board_connections enable row level security;
alter table public.storage_files     enable row level security;

-- Visitantes não logados não têm acesso a nenhuma tabela
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- PROFILES: ler e editar somente o próprio perfil
-- (o perfil é criado pelo gatilho, por isso não há política de INSERT)
-- ---------------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- CATEGORIES: todos veem as do sistema + as próprias; só editam as próprias
-- ---------------------------------------------------------------------
create policy "categories_select" on public.categories
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy "categories_insert_own" on public.categories
  for insert to authenticated
  with check (user_id = (select auth.uid()) and is_system = false);

create policy "categories_update_own" on public.categories
  for update to authenticated
  using (user_id = (select auth.uid()) and is_system = false)
  with check (user_id = (select auth.uid()) and is_system = false);

create policy "categories_delete_own" on public.categories
  for delete to authenticated
  using (user_id = (select auth.uid()) and is_system = false);

-- ---------------------------------------------------------------------
-- CONTENTS: somente o dono; a categoria precisa ser do sistema ou do dono
-- ---------------------------------------------------------------------
create policy "contents_owner_all" on public.contents
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.categories c
      where c.id = category_id
        and (c.user_id is null or c.user_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------
-- REVIEWS, PROJECTS, BOARD_ELEMENTS, BOARD_CONNECTIONS, STORAGE_FILES
-- As chaves compostas do schema.sql já garantem que o user_id é o mesmo
-- do projeto/obra relacionado. Aqui garantimos que é o do usuário logado.
-- ---------------------------------------------------------------------
create policy "reviews_owner_all" on public.reviews
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "projects_owner_all" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "board_elements_owner_all" on public.board_elements
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "board_connections_owner_all" on public.board_connections
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "storage_files_owner_all" on public.storage_files
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));