-- =====================================================================
-- hardening.sql  |  ENDURECIMENTO DE SEGURANÇA (Etapa 9)
-- Execute DEPOIS de schema.sql, policies.sql e storage.sql. Pode rodar de novo.
-- Se um dia você rodar o storage.sql outra vez, rode este arquivo de novo.
--
-- Números que você pode ajustar (procure por eles abaixo):
--   100 projetos por conta | 2000 elementos e 4000 conexões por quadro
--   1000 obras por conta   | imagens: 1000 arquivos e 300 MB (quadros) / 100 MB (capas)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) LIMITES DE TAMANHO DOS CAMPOS JSON
-- (o backend já valida, mas o banco também recebe chamadas diretas)
-- ---------------------------------------------------------------------
alter table public.board_elements drop constraint if exists board_elements_data_size;
alter table public.board_elements
  add constraint board_elements_data_size check (octet_length(data::text) <= 131072);

alter table public.board_connections drop constraint if exists board_connections_data_size;
alter table public.board_connections
  add constraint board_connections_data_size check (octet_length(data::text) <= 4096);

alter table public.projects drop constraint if exists projects_viewport_valid;
alter table public.projects
  add constraint projects_viewport_valid
  check (jsonb_typeof(viewport) = 'object' and octet_length(viewport::text) <= 1024);

-- ---------------------------------------------------------------------
-- 2) LIMITES DE QUANTIDADE DE REGISTROS
-- Argumentos: coluna que identifica o "dono", limite, descrição (aparece na mensagem).
-- Atualizar um registro que já existe (upsert) nunca é bloqueado.
-- ---------------------------------------------------------------------
create or replace function public.enforce_row_limit()
returns trigger
language plpgsql
as $$
declare
  v_column text := tg_argv[0];
  v_limit  integer := tg_argv[1]::integer;
  v_label  text := tg_argv[2];
  v_owner  uuid;
  v_exists boolean;
  v_count  bigint;
begin
  v_owner := (to_jsonb(new) ->> v_column)::uuid;

  execute format('select exists (select 1 from %I.%I where id = $1)', tg_table_schema, tg_table_name)
    into v_exists using new.id;
  if v_exists then
    return new;
  end if;

  execute format('select count(*) from %I.%I where %I = $1', tg_table_schema, tg_table_name, v_column)
    into v_count using v_owner;

  if v_count >= v_limit then
    raise exception 'Limite de % atingido (máximo de %).', v_label, v_limit
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_row_limit on public.projects;
create trigger projects_row_limit
  before insert on public.projects
  for each row execute function public.enforce_row_limit('user_id', '100', 'projetos');

drop trigger if exists board_elements_row_limit on public.board_elements;
create trigger board_elements_row_limit
  before insert on public.board_elements
  for each row execute function public.enforce_row_limit('project_id', '2000', 'elementos neste quadro');

drop trigger if exists board_connections_row_limit on public.board_connections;
create trigger board_connections_row_limit
  before insert on public.board_connections
  for each row execute function public.enforce_row_limit('project_id', '4000', 'conexões neste quadro');

-- O catálogo carrega até 1000 obras por consulta; o limite do banco acompanha isso
drop trigger if exists contents_row_limit on public.contents;
create trigger contents_row_limit
  before insert on public.contents
  for each row execute function public.enforce_row_limit('user_id', '1000', 'obras no catálogo');

-- ---------------------------------------------------------------------
-- 3) STORAGE_FILES: só a própria pasta e só projetos/obras do próprio usuário
-- ---------------------------------------------------------------------
drop policy if exists "storage_files_owner_all" on public.storage_files;
create policy "storage_files_owner_all" on public.storage_files
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and path like ((select auth.uid())::text || '/%')
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = project_id and p.user_id = (select auth.uid())
      )
    )
    and (
      content_id is null
      or exists (
        select 1 from public.contents c
        where c.id = content_id and c.user_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------
-- 4) STORAGE: políticas separadas, com cota de arquivos e de espaço por usuário
-- (sem política de UPDATE: o site só envia arquivos novos e apaga; nunca sobrescreve)
-- A cota usa uma função SECURITY DEFINER: uma consulta direta a storage.objects
-- dentro da própria política causa "recursão infinita" no RLS.
-- ---------------------------------------------------------------------
create or replace function public.storage_quota_ok(
  p_bucket text,
  p_max_files integer,
  p_max_bytes bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < p_max_files
     and coalesce(sum((o.metadata ->> 'size')::bigint), 0) < p_max_bytes
  from storage.objects o
  where o.bucket_id = p_bucket
    and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;

revoke all on function public.storage_quota_ok(text, integer, bigint) from public, anon;
grant execute on function public.storage_quota_ok(text, integer, bigint) to authenticated;

drop policy if exists "covers_owner_all" on storage.objects;
drop policy if exists "covers_select_own" on storage.objects;
drop policy if exists "covers_insert_own" on storage.objects;
drop policy if exists "covers_delete_own" on storage.objects;
drop policy if exists "board_images_owner_all" on storage.objects;
drop policy if exists "board_images_select_own" on storage.objects;
drop policy if exists "board_images_insert_own" on storage.objects;
drop policy if exists "board_images_delete_own" on storage.objects;

-- Capas das obras: até 1000 arquivos e 100 MB por usuário
create policy "covers_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "covers_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.storage_quota_ok('covers', 1000, 104857600)
  );

create policy "covers_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Imagens dos quadros: até 1000 arquivos e 300 MB por usuário
create policy "board_images_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'board-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "board_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'board-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.storage_quota_ok('board-images', 1000, 314572800)
  );

create policy "board_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'board-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------
-- 5) PERMISSÕES DE FUNÇÕES
-- ---------------------------------------------------------------------
-- A linha do tempo só faz sentido para quem está logado
revoke all on function public.contents_timeline(text) from public, anon;
grant execute on function public.contents_timeline(text) to authenticated;

-- Funções de gatilho não precisam ser chamáveis por ninguém de fora
-- (os gatilhos continuam funcionando normalmente)
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end
$$;