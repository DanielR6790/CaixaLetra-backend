// Regras dos elementos do quadro (caixas de texto e imagens).
// Todas as consultas usam a conexão "como o usuário" (req.supabase),
// então o RLS do banco garante que cada um só mexe nos próprios elementos.
import { AppError } from '../utils/AppError.js';
import { assertNoError } from '../utils/db.js';
import { assertProjectExists } from './projectGuard.js';
import { removeBoardImages } from './storageCleanup.js';

const COLUMNS = 'id, type, x, y, width, height, z_index, data';
const PAGE_SIZE = 1000; // limite de linhas por consulta do Supabase

function toDto(row) {
  return {
    id: row.id,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    zIndex: row.z_index,
    data: row.data,
  };
}

export async function listElements(supabase, projectId) {
  await assertProjectExists(supabase, projectId);

  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('board_elements')
      .select(COLUMNS)
      .eq('project_id', projectId)
      .order('z_index', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    assertNoError(error, 'Não foi possível carregar o quadro.');

    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return all.map(toDto);
}

// A imagem precisa estar na pasta do próprio usuário no Storage
function assertImagesBelongToUser(elements, userId) {
  for (const element of elements) {
    if (element.type !== 'image') continue;
    const { url, storagePath } = element.data;
    const ownFolder = storagePath.startsWith(`${userId}/`);
    const matchesUrl = url.includes(`/board-images/${storagePath}`);
    if (!ownFolder || !matchesUrl) {
      throw new AppError('Imagem inválida.', 400, 'VALIDATION_ERROR');
    }
  }
}

// Salva um lote de alterações: cria/atualiza os elementos de "upsert"
// e apaga os de "remove". Idempotente: repetir o mesmo lote não causa problema.
export async function syncElements(supabase, userId, projectId, { upsert, remove }) {
  await assertProjectExists(supabase, projectId);

  // Se o mesmo ID aparecer duas vezes, vale a última versão
  const byId = new Map(upsert.map((element) => [element.id, element]));
  const elements = [...byId.values()];
  const removeIds = remove.filter((id) => !byId.has(id));

  assertImagesBelongToUser(elements, userId);

  if (elements.length > 0) {
    // Impede "mover" um elemento de outro projeto seu para este
    const { data: existing, error: readError } = await supabase
      .from('board_elements')
      .select('id, project_id')
      .in('id', [...byId.keys()]);
    assertNoError(readError, 'Não foi possível salvar o quadro.');

    if (existing.some((row) => row.project_id !== projectId)) {
      throw new AppError('Um dos elementos pertence a outro projeto.', 409, 'CONFLICT');
    }

    const rows = elements.map((element) => ({
      id: element.id,
      project_id: projectId,
      user_id: userId,
      type: element.type,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      z_index: element.zIndex,
      data: element.data,
    }));

    const { error } = await supabase.from('board_elements').upsert(rows, { onConflict: 'id' });
    assertNoError(error, 'Não foi possível salvar o quadro.');
  }

  if (removeIds.length > 0) {
    // Guarda os arquivos das imagens que serão apagadas
    const { data: doomed, error: doomedError } = await supabase
      .from('board_elements')
      .select('id, data')
      .eq('project_id', projectId)
      .eq('type', 'image')
      .in('id', removeIds);
    assertNoError(doomedError, 'Não foi possível salvar o quadro.');

    // As conexões ligadas a estes elementos são apagadas pelo banco (ON DELETE CASCADE)
    const { error } = await supabase
      .from('board_elements')
      .delete()
      .eq('project_id', projectId)
      .in('id', removeIds);
    assertNoError(error, 'Não foi possível salvar o quadro.');

    const paths = doomed.map((row) => row.data?.storagePath).filter(Boolean);
    await removeBoardImages(supabase, paths);
  }

  return { saved: elements.length, removed: removeIds.length };
}