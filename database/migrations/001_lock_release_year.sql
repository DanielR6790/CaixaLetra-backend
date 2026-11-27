-- =====================================================================
-- 001_lock_release_year.sql
-- Obras vindas de uma API (source <> 'manual') não podem ter o ano de
-- lançamento alterado, a menos que ele esteja vazio (aí pode ser preenchido).
-- Substitui a função de gatilho existente (as permissões dela são mantidas).
-- Pode rodar de novo sem problema.
-- =====================================================================
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

    -- O ano de lançamento oficial de uma obra de API não pode ser alterado
    if old.source <> 'manual'
       and old.release_year is not null
       and new.release_year is distinct from old.release_year then
      raise exception 'O ano de lançamento de obras vindas de uma API não pode ser alterado.'
        using errcode = 'check_violation';
    end if;
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