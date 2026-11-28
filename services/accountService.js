// Regras da conta: exportar os dados do usuário e excluir a conta.
// Usa a conexão "como o usuário" (req.supabase): o RLS garante que só os dados dele são lidos e apagados.
import { createAnonClient } from '../config/supabase.js';
import { AppError } from '../utils/AppError.js';
import { assertNoError } from '../utils/db.js';

const PAGE_SIZE = 1000; // limite de linhas por consulta do Supabase
const LIST_PAGE = 100; // arquivos por consulta do Storage
const BUCKETS = ['covers', 'board-images', 'avatars'];

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    assertNoError(error, 'Não foi possível reunir os seus dados.');
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

const one = (value) => (Array.isArray(value) ? value[0] : value) ?? null;

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}

function toCatalogEntry(row) {
  const review = one(row.review);
  return {
    id: row.id,
    category: one(row.category)?.slug ?? null,
    title: row.title,
    releaseYear: row.release_year,
    genre: row.genre,
    contentType: row.content_type,
    description: row.description,
    coverUrl: row.cover_url,
    source: row.source,
    externalId: row.external_id,
    status: row.status,
    favorite: Boolean(row.is_favorite),
    addedAt: row.added_at,
    consumedAt: row.consumed_at,
    updatedAt: row.updated_at,
    review: review
      ? {
          rating: review.rating,
          text: review.review_text,
          createdAt: review.created_at,
          updatedAt: review.updated_at,
        }
      : null,
  };
}

// Reúne tudo o que pertence ao usuário (perfil, catálogo, avaliações e quadros)
export async function exportAccountData(supabase, user) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, timezone, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();
  assertNoError(profileError, 'Não foi possível reunir os seus dados.');

  const contents = await fetchAll(() =>
    supabase
      .from('contents')
      .select(
        `id, title, release_year, genre, description, cover_url, content_type, source, external_id,
         status, is_favorite, consumed_at, added_at, updated_at,
         category:categories ( slug ),
         review:reviews ( rating, review_text, created_at, updated_at )`
      )
      .order('added_at', { ascending: true })
      .order('id', { ascending: true })
  );

  const projects = await fetchAll(() =>
    supabase
      .from('projects')
      .select('id, name, description, board_theme, viewport, created_at, updated_at')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
  );

  const elements = await fetchAll(() =>
    supabase
      .from('board_elements')
      .select('id, project_id, type, x, y, width, height, z_index, data, created_at, updated_at')
      .eq('user_id', user.id)
      .order('project_id', { ascending: true })
      .order('id', { ascending: true })
  );

  const connections = await fetchAll(() =>
    supabase
      .from('board_connections')
      .select('id, project_id, source_element_id, target_element_id, label, created_at')
      .eq('user_id', user.id)
      .order('project_id', { ascending: true })
      .order('id', { ascending: true })
  );

  const elementsByProject = groupBy(elements, 'project_id');
  const connectionsByProject = groupBy(connections, 'project_id');

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    account: {
      email: user.email,
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      timezone: profile?.timezone ?? null,
      createdAt: profile?.created_at ?? null,
    },
    catalog: contents.map(toCatalogEntry),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      boardTheme: project.board_theme,
      viewport: project.viewport,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      elements: (elementsByProject.get(project.id) ?? []).map((element) => ({
        id: element.id,
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.z_index,
        data: element.data,
        createdAt: element.created_at,
        updatedAt: element.updated_at,
      })),
      connections: (connectionsByProject.get(project.id) ?? []).map((connection) => ({
        id: connection.id,
        sourceId: connection.source_element_id,
        targetId: connection.target_element_id,
        label: connection.label,
        createdAt: connection.created_at,
      })),
    })),
  };
}

// Apaga do Storage todos os arquivos do usuário (a pasta de cada bucket tem o ID dele)
async function removeUserFiles(supabase, userId) {
  for (const bucket of BUCKETS) {
    for (let round = 0; round < 1000; round += 1) {
      const { data, error } = await supabase.storage.from(bucket).list(userId, { limit: LIST_PAGE });
      if (error) {
        console.error('[Storage]', bucket, error.message);
        throw new AppError('Não foi possível apagar os seus arquivos.', 500, 'STORAGE_ERROR');
      }

      const files = (data ?? []).filter((entry) => entry.name && entry.id !== null);
      if (files.length === 0) break;

      const { error: removeError } = await supabase.storage
        .from(bucket)
        .remove(files.map((entry) => `${userId}/${entry.name}`));
      if (removeError) {
        console.error('[Storage]', bucket, removeError.message);
        throw new AppError('Não foi possível apagar os seus arquivos.', 500, 'STORAGE_ERROR');
      }
    }
  }
}

// Exclui a conta de forma definitiva: confere a senha, apaga os arquivos e depois o usuário.
export async function deleteAccount(supabase, user, password) {
  const { error: authError } = await createAnonClient().auth.signInWithPassword({
    email: user.email,
    password,
  });

  if (authError) {
    if (authError.name === 'AuthRetryableFetchError' || (authError.status ?? 0) >= 500) {
      throw new AppError(
        'Serviço de autenticação indisponível. Tente novamente em instantes.',
        503,
        'AUTH_UNAVAILABLE'
      );
    }
    if (authError.status === 429) {
      throw new AppError('Muitas tentativas. Aguarde alguns minutos.', 429, 'RATE_LIMIT');
    }
    throw new AppError('Senha incorreta.', 403, 'WRONG_PASSWORD');
  }

  await removeUserFiles(supabase, user.id);

  const { error } = await supabase.rpc('delete_my_account');
  assertNoError(error, 'Não foi possível excluir a conta.');
}