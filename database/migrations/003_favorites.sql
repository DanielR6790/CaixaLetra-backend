-- =====================================================================
-- 003_favorites.sql
-- Marca de favorito nas obras do catálogo. Cada usuário só enxerga e altera as
-- próprias obras (RLS da tabela contents), então os favoritos também são individuais.
-- Pode rodar de novo sem problema.
-- =====================================================================
alter table public.contents
  add column if not exists is_favorite boolean not null default false;

-- Acelera "mostrar só os favoritos" (índice só das obras favoritas)
create index if not exists contents_user_favorite_idx
  on public.contents (user_id)
  where is_favorite;

-- Faz a API do Supabase enxergar a coluna nova na hora
notify pgrst, 'reload schema';