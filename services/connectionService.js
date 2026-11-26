// Regras das conexões (setas) entre elementos do quadro.
import { AppError } from '../utils/AppError.js';
import { assertNoError } from '../utils/db.js';
import { assertProjectExists } from './projectGuard.js';

const COLUMNS = 'id, source_element_id, target_element_id';
const PAGE_SIZE = 1000;

const toDto = (row) => ({
  id: row.id,
  sourceId: row.source_element_id,
  targetId: row.target_element_id,
});

export async function listConnections(supabase, projectId) {
  await assertProjectExists(supabase, projectId);

  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('board_connections')
      .select(COLUMNS)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    assertNoError(error, 'Não foi possível carregar as conexões.');

    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return all.map(toDto);
}

// Salva um lote: apaga as conexões de "remove" e cria/atualiza as de "upsert".
// Apagar vem primeiro, para poder refazer a mesma ligação (mesma origem e destino).
export async function syncConnections(supabase, userId, projectId, { upsert, remove }) {
  await assertProjectExists(supabase, projectId);

  const byId = new Map(upsert.map((connection) => [connection.id, connection]));
  const connections = [...byId.values()];
  const removeIds = remove.filter((id) => !byId.has(id));

  if (removeIds.length > 0) {
    const { error } = await supabase
      .from('board_connections')
      .delete()
      .eq('project_id', projectId)
      .in('id', removeIds);
    assertNoError(error, 'Não foi possível salvar as conexões.');
  }

  if (connections.length > 0) {
    const rows = connections.map((connection) => ({
      id: connection.id,
      project_id: projectId,
      user_id: userId,
      source_element_id: connection.sourceId,
      target_element_id: connection.targetId,
    }));

    const { error } = await supabase.from('board_connections').upsert(rows, { onConflict: 'id' });

    if (error?.code === '23503') {
      throw new AppError(
        'Uma conexão aponta para um elemento que não existe mais.',
        409,
        'CONFLICT'
      );
    }
    if (error?.code === '23505') {
      throw new AppError('Essa conexão já existe.', 409, 'DUPLICATE');
    }
    assertNoError(error, 'Não foi possível salvar as conexões.');
  }

  return { saved: connections.length, removed: removeIds.length };
}