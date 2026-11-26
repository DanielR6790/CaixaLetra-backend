// Regras dos projetos de organização de ideias.
// Todas as consultas usam a conexão "como o usuário" (req.supabase),
// então o RLS do banco garante que cada um só mexe nos próprios projetos.
import { AppError } from '../utils/AppError.js';
import { assertNoError } from '../utils/db.js';
import { collectBoardImagePaths, removeBoardImages } from './storageCleanup.js';

const LIST_COLUMNS = 'id, name, description, board_theme, created_at, updated_at';
const FULL_COLUMNS = `${LIST_COLUMNS}, viewport`;

// Converte a linha do banco para o formato usado pelo frontend
function toDto(row) {
  const dto = {
    id: row.id,
    name: row.name,
    description: row.description,
    boardTheme: row.board_theme,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.viewport !== undefined) dto.viewport = row.viewport;
  return dto;
}

export async function listProjects(supabase) {
  const { data, error } = await supabase
    .from('projects')
    .select(LIST_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(200);
  assertNoError(error, 'Não foi possível carregar os projetos.');
  return data.map(toDto);
}

export async function getProject(supabase, id) {
  const { data, error } = await supabase
    .from('projects')
    .select(FULL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  assertNoError(error, 'Não foi possível carregar o projeto.');
  if (!data) throw new AppError('Projeto não encontrado.', 404, 'NOT_FOUND');
  return toDto(data);
}

export async function createProject(supabase, userId, { name, description }) {
  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, name, description: description ?? null })
    .select(FULL_COLUMNS)
    .single();
  assertNoError(error, 'Não foi possível criar o projeto.');
  return toDto(data);
}

export async function updateProject(supabase, id, patch) {
  const row = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.boardTheme !== undefined) row.board_theme = patch.boardTheme;
  if (patch.viewport !== undefined) row.viewport = patch.viewport;

  const { data, error } = await supabase
    .from('projects')
    .update(row)
    .eq('id', id)
    .select(FULL_COLUMNS)
    .maybeSingle();
  assertNoError(error, 'Não foi possível atualizar o projeto.');
  if (!data) throw new AppError('Projeto não encontrado.', 404, 'NOT_FOUND');
  return toDto(data);
}

// Apagar o projeto apaga junto, pelo banco, seus elementos e conexões.
// As imagens do quadro (Storage) são apagadas em seguida.
export async function deleteProject(supabase, id) {
  // Lista os arquivos ANTES, porque depois da exclusão os registros somem
  const imagePaths = await collectBoardImagePaths(supabase, id);

  const { data, error } = await supabase.from('projects').delete().eq('id', id).select('id');
  assertNoError(error, 'Não foi possível excluir o projeto.');
  if (!data || data.length === 0) throw new AppError('Projeto não encontrado.', 404, 'NOT_FOUND');

  await removeBoardImages(supabase, imagePaths);
}