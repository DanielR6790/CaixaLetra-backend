-- =====================================================================
-- storage.sql  |  ARMAZENAMENTO DE IMAGENS (Supabase Storage)
-- Execute por último, depois do policies.sql.
--
-- Dois "buckets" (pastas principais):
--   covers        -> capas personalizadas das obras (máx. 5 MB)
--   board-images  -> imagens dos quadros de ideias (máx. 10 MB)
--
-- Os arquivos ficam em:  <id_do_usuario>/<nome_aleatorio>.<extensão>
-- Cada usuário só consegue enviar, alterar ou apagar arquivos da própria
-- pasta. A leitura é pública (necessária para exibir a imagem pela URL),
-- mas os nomes são aleatórios e impossíveis de adivinhar.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('covers', 'covers', true, 5242880,
     array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('board-images', 'board-images', true, 10485760,
     array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "covers_owner_all" on storage.objects;
create policy "covers_owner_all" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "board_images_owner_all" on storage.objects;
create policy "board_images_owner_all" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'board-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'board-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );