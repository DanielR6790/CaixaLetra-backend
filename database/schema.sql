-- =====================================================================
-- schema.sql  |  ESTRUTURA DO BANCO (tabelas, índices, gatilhos)
-- Execute este arquivo UMA vez, primeiro, no SQL Editor do Supabase.
-- Para refazer do zero em testes, descomente o bloco abaixo e rode antes:
--
-- drop table if exists public.storage_files, public.board_connections,
--   public.board_elements, public.projects, public.reviews,
--   public.contents, public.categories, public.profiles cascade;
-- =====================================================================

-- ---------------------------------------------------------------------
-- Função genérica: atualiza "updated_at" automaticamente
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1) PROFILES: dados públicos do usuário (1 linha por conta)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  avatar_url  text,
  timezone    text not null default 'America/Sao_Paulo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,30}$')
);

-- Nome de usuário único, sem diferenciar maiúsculas de minúsculas
create unique index profiles_username_unique on public.profiles (lower(username));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria o perfil automaticamente quando alguém se cadastra.
-- O nome de usuário vem dos metadados enviados no cadastro (Etapa 4).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  v_username := new.raw_user_meta_data ->> 'username';

  -- Se vier vazio, inválido ou já usado, gera um nome provisório
  if v_username is null
     or v_username !~ '^[A-Za-z0-9_]{3,30}$'
     or exists (select 1 from public.profiles where lower(username) = lower(v_username))
  then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;

  insert into public.profiles (id, username) values (new.id, v_username);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Permite verificar, ANTES do cadastro, se um nome de usuário está livre
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(p_username)
  );
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) CATEGORIES: categorias do sistema (user_id nulo) e personalizadas
-- ---------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9_-]{2,40}$'),
  name        text not null check (char_length(name) between 1 and 60),
  is_system   boolean not null default false,
  sort_order  smallint not null default 100,
  created_at  timestamptz not null default now(),
  constraint categories_system_consistency
    check ((is_system and user_id is null) or (not is_system and user_id is not null))
);

create unique index categories_system_slug_uq on public.categories (slug) where user_id is null;
create unique index categories_user_slug_uq   on public.categories (user_id, slug) where user_id is not null;

insert into public.categories (slug, name, is_system, sort_order) values
  ('filmes', 'Filmes', true, 10),
  ('series', 'Séries', true, 20),
  ('animes', 'Animes', true, 30),
  ('jogos',  'Jogos',  true, 40),
  ('outros', 'Outros', true, 50)
on conflict (slug) where user_id is null do nothing;

-- ---------------------------------------------------------------------
-- 3) CONTENTS: obras do catálogo
-- ---------------------------------------------------------------------
create table public.contents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  category_id   uuid not null references public.categories(id) on delete restrict,

  title         text not null check (char_length(title) between 1 and 300),
  release_year  smallint check (release_year between 1800 and 2200),
  genre         text check (char_length(genre) <= 200),
  description   text check (char_length(description) <= 10000),
  cover_url     text check (char_length(cover_url) <= 2000),
  content_type  text check (char_length(content_type) <= 60),

  -- Origem dos dados e ID na API externa (evita duplicatas)
  source        text not null default 'manual'
                check (source in ('manual', 'tmdb', 'rawg', 'anilist')),
  external_id   text check (char_length(external_id) <= 50),

  -- para_consumir -> consumido -> avaliado
  status        text not null default 'para_consumir'
                check (status in ('para_consumir', 'consumido', 'avaliado')),
  consumed_at   timestamptz,

  -- DATA DE ADIÇÃO: definida pelo banco e nunca alterada
  added_at      timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint contents_external_id_required
    check (source = 'manual' or external_id is not null),
  -- Necessário para vincular reviews ao mesmo dono (chave composta)
  constraint contents_id_user_unique unique (id, user_id)
);

-- Impede a mesma obra da mesma API na mesma categoria, para o mesmo usuário
create unique index contents_no_duplicate_external
  on public.contents (user_id, category_id, source, external_id)
  where external_id is not null;

create index contents_user_category_status_idx on public.contents (user_id, category_id, status);
create index contents_user_added_at_idx        on public.contents (user_id, added_at desc);
create index contents_user_title_idx           on public.contents (user_id, lower(title));
create index contents_user_year_idx            on public.contents (user_id, release_year);

-- Regras automáticas de proteção dos dados
create or replace function public.contents_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- A data de adição SEMPRE vem do relógio do banco
    new.added_at := now();
  else
    -- Editar a obra ou a review nunca altera a data de adição nem o dono
    new.added_at := old.added_at;
    new.user_id  := old.user_id;
  end if;

  -- Data em que foi marcado como consumido
  if new.status in ('consumido', 'avaliado') then
    new.consumed_at := coalesce(new.consumed_at, now());
  else
    new.consumed_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger contents_guard_trigger
  before insert or update on public.contents
  for each row execute function public.contents_guard();

-- ---------------------------------------------------------------------
-- 4) REVIEWS: nota (1 a 10) e texto opcional
-- ---------------------------------------------------------------------
create table public.reviews (
  id           uuid primary key default gen_random_uuid(),
  content_id   uuid not null,
  user_id      uuid not null,
  rating       smallint not null check (rating between 1 and 10),
  review_text  text check (char_length(review_text) <= 20000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint reviews_one_per_content unique (content_id),
  -- Garante que a review pertence ao mesmo usuário dono da obra
  constraint reviews_content_owner_fk
    foreign key (content_id, user_id)
    references public.contents (id, user_id) on delete cascade
);

create index reviews_user_idx on public.reviews (user_id);

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- Ao criar uma review, a obra passa a "avaliado"
create or replace function public.review_mark_content_rated()
returns trigger
language plpgsql
as $$
begin
  update public.contents set status = 'avaliado' where id = new.content_id;
  return new;
end;
$$;

create trigger reviews_after_insert
  after insert on public.reviews
  for each row execute function public.review_mark_content_rated();

-- Ao remover a avaliação, a obra volta para "consumido" (continua no catálogo)
create or replace function public.review_unmark_content_rated()
returns trigger
language plpgsql
as $$
begin
  update public.contents set status = 'consumido'
   where id = old.content_id and status = 'avaliado';
  return old;
end;
$$;

create trigger reviews_after_delete
  after delete on public.reviews
  for each row execute function public.review_unmark_content_rated();

-- ---------------------------------------------------------------------
-- 5) PROJECTS: projetos de organização de ideias
-- ---------------------------------------------------------------------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  description  text check (char_length(description) <= 2000),
  board_theme  text not null default 'dark' check (board_theme in ('dark', 'light')),
  -- Posição e zoom salvos do quadro: {"x":0,"y":0,"zoom":1}
  viewport     jsonb not null default '{"x":0,"y":0,"zoom":1}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint projects_id_user_unique unique (id, user_id)
);

create index projects_user_updated_idx on public.projects (user_id, updated_at desc);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6) BOARD_ELEMENTS: caixas de texto e imagens do quadro
-- ---------------------------------------------------------------------
create table public.board_elements (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  user_id     uuid not null,
  type        text not null check (type in ('text', 'image')),
  x           double precision not null default 0,
  y           double precision not null default 0,
  width       double precision not null default 240 check (width > 0 and width <= 20000),
  height      double precision not null default 120 check (height > 0 and height <= 20000),
  z_index     integer not null default 0,
  -- Texto: {"text","fontSize","color","background","align","bold","italic"}
  -- Imagem: {"url","storagePath"}
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint board_elements_project_owner_fk
    foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  -- Necessário para que as conexões fiquem sempre dentro do mesmo projeto
  constraint board_elements_id_project_unique unique (id, project_id)
);

create index board_elements_project_idx on public.board_elements (project_id);
create index board_elements_user_idx    on public.board_elements (user_id);

create trigger board_elements_set_updated_at
  before update on public.board_elements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 7) BOARD_CONNECTIONS: setas entre elementos
-- ---------------------------------------------------------------------
create table public.board_connections (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null,
  user_id            uuid not null,
  source_element_id  uuid not null,
  target_element_id  uuid not null,
  label              text check (char_length(label) <= 200),
  data               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),

  constraint board_connections_no_self_loop check (source_element_id <> target_element_id),
  constraint board_connections_unique_pair unique (source_element_id, target_element_id),

  constraint board_connections_project_owner_fk
    foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  -- Apagar um elemento apaga automaticamente as setas ligadas a ele
  constraint board_connections_source_fk
    foreign key (source_element_id, project_id)
    references public.board_elements (id, project_id) on delete cascade,
  constraint board_connections_target_fk
    foreign key (target_element_id, project_id)
    references public.board_elements (id, project_id) on delete cascade
);

create index board_connections_project_idx on public.board_connections (project_id);
create index board_connections_source_idx  on public.board_connections (source_element_id);
create index board_connections_target_idx  on public.board_connections (target_element_id);

-- Qualquer mudança no quadro atualiza "Última atualização" do projeto
create or replace function public.touch_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.projects
     set updated_at = now()
   where id = coalesce(new.project_id, old.project_id);
  return null;
end;
$$;

revoke execute on function public.touch_project() from public, anon, authenticated;

create trigger board_elements_touch_project
  after insert or update or delete on public.board_elements
  for each row execute function public.touch_project();

create trigger board_connections_touch_project
  after insert or update or delete on public.board_connections
  for each row execute function public.touch_project();

-- ---------------------------------------------------------------------
-- 8) STORAGE_FILES: registro dos arquivos enviados (para limpeza futura)
-- ---------------------------------------------------------------------
create table public.storage_files (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  bucket      text not null check (bucket in ('covers', 'board-images')),
  path        text not null,
  mime_type   text,
  size_bytes  bigint check (size_bytes >= 0),
  content_id  uuid references public.contents(id) on delete set null,
  project_id  uuid references public.projects(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint storage_files_unique_path unique (bucket, path)
);

create index storage_files_user_idx    on public.storage_files (user_id);
create index storage_files_content_idx on public.storage_files (content_id);
create index storage_files_project_idx on public.storage_files (project_id);

-- ---------------------------------------------------------------------
-- FUNÇÃO: quantas obras foram adicionadas em cada ano/mês
-- Usa o fuso horário do perfil do usuário (padrão: America/Sao_Paulo).
-- Roda com as permissões do usuário, então o RLS continua valendo.
-- ---------------------------------------------------------------------
create or replace function public.contents_timeline(p_category_slug text default null)
returns table (ano integer, mes integer, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with tz as (
    select coalesce(
      (select p.timezone from public.profiles p where p.id = auth.uid()),
      'America/Sao_Paulo'
    ) as name
  )
  select
    extract(year  from c.added_at at time zone tz.name)::integer as ano,
    extract(month from c.added_at at time zone tz.name)::integer as mes,
    count(*) as total
  from public.contents c
  join public.categories cat on cat.id = c.category_id
  cross join tz
  where p_category_slug is null or cat.slug = p_category_slug
  group by 1, 2
  order by 1 desc, 2 desc;
$$;