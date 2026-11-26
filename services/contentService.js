// Regras do catálogo: listar, criar, editar e remover obras e avaliações.
// Todas as consultas usam a conexão "como o usuário" (req.supabase),
// então o RLS do banco garante que cada um só mexe nos próprios dados.
import { AppError } from '../utils/AppError.js';
import { assertNoError } from '../utils/db.js';

const SELECT = `
  id, title, release_year, genre, description, cover_url, content_type,
  source, external_id, status, consumed_at, added_at, updated_at,
  category:categories ( slug ),
  review:reviews ( id, rating, review_text, created_at, updated_at )
`;

const COVER_MARKER = '/storage/v1/object/public/covers/';

// Converte a linha do banco para o formato usado pelo frontend
function toDto(row) {
  const review = Array.isArray(row.review) ? row.review[0] : row.review;
  return {
    id: row.id,
    categorySlug: row.category?.slug ?? null,
    title: row.title,
    releaseYear: row.release_year,
    genre: row.genre,
    description: row.description,
    coverUrl: row.cover_url,
    contentType: row.content_type,
    source: row.source,
    externalId: row.external_id,
    status: row.status,
    consumedAt: row.consumed_at,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    review: review
      ? {
          id: review.id,
          rating: review.rating,
          reviewText: review.review_text,
          createdAt: review.created_at,
          updatedAt: review.updated_at,
        }
      : null,
  };
}

async function getCategoryId(supabase, slug) {
  const { data, error } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', slug)
    .is('user_id', null)
    .maybeSingle();
  assertNoError(error, 'Não foi possível carregar a categoria.');
  if (!data) throw new AppError('Categoria não encontrada.', 404, 'NOT_FOUND');
  return data.id;
}

export async function getContentById(supabase, id) {
  const { data, error } = await supabase.from('contents').select(SELECT).eq('id', id).maybeSingle();
  assertNoError(error, 'Não foi possível carregar a obra.');
  if (!data) throw new AppError('Obra não encontrada.', 404, 'NOT_FOUND');
  return toDto(data);
}

// categorySlug = "all" lista todas as categorias (usado na Linha do tempo).
// O Supabase devolve no máximo 1000 linhas por consulta.
export async function listContents(supabase, categorySlug) {
  let query = supabase
    .from('contents')
    .select(SELECT)
    .order('added_at', { ascending: false })
    .limit(1000);

  if (categorySlug !== 'all') {
    query = query.eq('category_id', await getCategoryId(supabase, categorySlug));
  }

  const { data, error } = await query;
  assertNoError(error, 'Não foi possível carregar o catálogo.');
  return data.map(toDto);
}

// Obras manuais não têm ID externo, então comparamos título (sem diferenciar
// maiúsculas) e ano dentro da mesma categoria.
// Obras manuais não têm ID externo, então comparamos título (sem diferenciar
// maiúsculas) e ano dentro da mesma categoria. A busca no banco pode trazer
// candidatos a mais (o "*" funciona como curinga), por isso a comparação
// final é feita aqui, pelo título exato.
async function assertNoManualDuplicate(supabase, categoryId, input) {
  const escaped = input.title.replace(/[\\%_]/g, '\\$&');
  const { data, error } = await supabase
    .from('contents')
    .select('id, title, release_year')
    .eq('category_id', categoryId)
    .ilike('title', escaped);
  assertNoError(error, 'Não foi possível verificar duplicatas.');

  const wantedTitle = input.title.trim().toLowerCase();
  const wantedYear = input.releaseYear ?? null;
  const duplicated = data.some(
    (row) =>
      row.title.trim().toLowerCase() === wantedTitle && (row.release_year ?? null) === wantedYear
  );
  if (duplicated) {
    throw new AppError('Você já tem uma obra com este título e ano nesta categoria.', 409, 'DUPLICATE');
  }
}

export async function createContent(supabase, userId, input) {
  const categoryId = await getCategoryId(supabase, input.categorySlug);

  if (input.source === 'manual') {
    await assertNoManualDuplicate(supabase, categoryId, input);
  }

  // Obra avaliada nasce como "consumido"; ao criar a review, o banco
  // (gatilho) muda o status para "avaliado".
  const { data, error } = await supabase
    .from('contents')
    .insert({
      user_id: userId,
      category_id: categoryId,
      title: input.title,
      release_year: input.releaseYear ?? null,
      genre: input.genre ?? null,
      description: input.description ?? null,
      cover_url: input.coverUrl ?? null,
      content_type: input.contentType ?? null,
      source: input.source,
      external_id: input.externalId ?? null,
      status: input.destination === 'avaliado' ? 'consumido' : 'para_consumir',
    })
    .select('id')
    .single();

  if (error?.code === '23505') {
    throw new AppError('Esta obra já está no seu catálogo.', 409, 'DUPLICATE');
  }
  assertNoError(error, 'Não foi possível salvar a obra.');

  if (input.destination === 'avaliado') {
    const { error: reviewError } = await supabase.from('reviews').insert({
      content_id: data.id,
      user_id: userId,
      rating: input.rating,
      review_text: input.reviewText ?? null,
    });
    if (reviewError) {
      // Desfaz: não deixa a obra salva sem a avaliação pedida
      await supabase.from('contents').delete().eq('id', data.id);
      assertNoError(reviewError, 'Não foi possível salvar a avaliação.');
    }
  }

  return getContentById(supabase, data.id);
}

// Apaga do Storage a capa enviada pelo usuário (capas de APIs são ignoradas)
async function removeOwnCover(supabase, coverUrl) {
  if (!coverUrl) return;
  const index = coverUrl.indexOf(COVER_MARKER);
  if (index === -1) return;

  const path = decodeURIComponent(coverUrl.slice(index + COVER_MARKER.length).split('?')[0]);
  try {
    await supabase.storage.from('covers').remove([path]);
    await supabase.from('storage_files').delete().eq('bucket', 'covers').eq('path', path);
  } catch (error) {
    console.warn('[Storage] Não foi possível limpar a capa:', error?.message);
  }
}

export async function updateContent(supabase, id, patch) {
  const row = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.releaseYear !== undefined) row.release_year = patch.releaseYear;
  if (patch.genre !== undefined) row.genre = patch.genre;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.contentType !== undefined) row.content_type = patch.contentType;
  if (patch.coverUrl !== undefined) row.cover_url = patch.coverUrl;
  if (patch.status !== undefined) row.status = patch.status;

  // Guarda a capa atual para apagá-la do Storage se for substituída
  let previousCover = null;
  if (patch.coverUrl !== undefined) {
    const { data: current, error: readError } = await supabase
      .from('contents')
      .select('cover_url')
      .eq('id', id)
      .maybeSingle();
    assertNoError(readError, 'Não foi possível carregar a obra.');
    previousCover = current?.cover_url ?? null;
  }

  let query = supabase.from('contents').update(row).eq('id', id);
  // Obras avaliadas mudam de status só pela avaliação, nunca pela caixa da lista
  if (patch.status !== undefined) query = query.neq('status', 'avaliado');

  const { data, error } = await query.select('id').maybeSingle();
  assertNoError(error, 'Não foi possível atualizar a obra.');
  if (!data) throw new AppError('Obra não encontrada ou já avaliada.', 404, 'NOT_FOUND');

  if (patch.coverUrl !== undefined && previousCover && previousCover !== (patch.coverUrl ?? null)) {
    await removeOwnCover(supabase, previousCover);
  }

  return getContentById(supabase, id);
}

export async function deleteContent(supabase, id) {
  const { data: row, error: readError } = await supabase
    .from('contents')
    .select('id, cover_url')
    .eq('id', id)
    .maybeSingle();
  assertNoError(readError, 'Não foi possível carregar a obra.');
  if (!row) throw new AppError('Obra não encontrada.', 404, 'NOT_FOUND');

  const { error } = await supabase.from('contents').delete().eq('id', id);
  assertNoError(error, 'Não foi possível remover a obra.');

  await removeOwnCover(supabase, row.cover_url);
}

// ---------------------------------------------------------------------
// AVALIAÇÕES
// ---------------------------------------------------------------------

// Cria a avaliação ou atualiza a existente (cada obra tem no máximo uma).
// Ao criar, o gatilho do banco muda o status da obra para "avaliado".
export async function upsertReview(supabase, userId, contentId, { rating, reviewText }) {
  await getContentById(supabase, contentId); // 404 se a obra não for do usuário

  const { error } = await supabase.from('reviews').upsert(
    {
      content_id: contentId,
      user_id: userId,
      rating,
      review_text: reviewText ?? null,
    },
    { onConflict: 'content_id' }
  );
  assertNoError(error, 'Não foi possível salvar a avaliação.');

  return getContentById(supabase, contentId);
}

// Remove nota e review. A obra continua no catálogo:
// o banco a marca como "consumido", e com toList ela volta para a lista.
export async function deleteReview(supabase, contentId, { toList }) {
  const content = await getContentById(supabase, contentId);
  if (!content.review) throw new AppError('Esta obra não tem avaliação.', 404, 'NOT_FOUND');

  const { error } = await supabase.from('reviews').delete().eq('content_id', contentId);
  assertNoError(error, 'Não foi possível remover a avaliação.');

  if (toList) {
    const { error: moveError } = await supabase
      .from('contents')
      .update({ status: 'para_consumir' })
      .eq('id', contentId);
    assertNoError(moveError, 'Não foi possível mover a obra para a lista.');
  }

  return getContentById(supabase, contentId);
}