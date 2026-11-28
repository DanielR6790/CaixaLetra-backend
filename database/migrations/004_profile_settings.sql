-- =====================================================================
-- 004_profile_settings.sql
-- Configurações do perfil: bucket de avatares, validação do fuso horário
-- e a função que permite ao usuário excluir a própria conta.
-- Pode rodar de novo sem problema. Depende da função storage_quota_ok (hardening).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Fotos de perfil: bucket "avatars" (público para leitura, até 2 MB por foto)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_select_own" on storage.objects;
drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;

create policy "avatars_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Até 20 arquivos e 20 MB por usuário (o site apaga a foto antiga ao trocar)
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.storage_quota_ok('avatars', 20, 20971520)
  );

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------
-- 2) Perfil: tamanho do endereço da foto e fuso horário válido
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_avatar_url_length;
alter table public.profiles
  add constraint profiles_avatar_url_length
  check (avatar_url is null or char_length(avatar_url) <= 2000);

create or replace function public.profiles_validate()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.profiles_validate() from public, anon, authenticated;

drop trigger if exists profiles_validate_trigger on public.profiles;
create trigger profiles_validate_trigger
  before insert or update of timezone on public.profiles
  for each row execute function public.profiles_validate();

-- ---------------------------------------------------------------------
-- 3) Excluir a própria conta
-- Apaga o usuário; o resto (perfil, obras, avaliações, projetos, elementos e
-- conexões) some junto, por exclusão em cascata. Os arquivos do Storage são
-- apagados antes, pelo backend.
-- ---------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;