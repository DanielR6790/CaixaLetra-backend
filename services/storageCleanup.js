// Limpeza das imagens dos quadros no Supabase Storage (bucket "board-images").
// Feita no "melhor esforço": se falhar, só registra no terminal, sem
// impedir a operação que o usuário pediu.
const BUCKET = 'board-images';
const PAGE_SIZE = 1000;
const REMOVE_CHUNK = 100;

// Só apaga automaticamente arquivos sem uso com mais de 30 segundos: um envio recém-feito
// em outra aba ainda pode estar esperando o elemento ser salvo no banco.
// Arquivos enviados explicitamente em "paths" (ex.: excluídos antes de sair/recarregar)
// são apagados na hora, sem esperar esse prazo.
const ORPHAN_MIN_AGE_MS = 30 * 1000;

async function collectAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

// Todos os arquivos de imagem ligados a um projeto
export async function collectBoardImagePaths(supabase, projectId) {
  const paths = new Set();
  try {
    const elements = await collectAll(() =>
      supabase
        .from('board_elements')
        .select('id, data')
        .eq('project_id', projectId)
        .eq('type', 'image')
        .order('id')
    );
    elements.forEach((row) => {
      if (typeof row.data?.storagePath === 'string') paths.add(row.data.storagePath);
    });

    const files = await collectAll(() =>
      supabase
        .from('storage_files')
        .select('id, path')
        .eq('bucket', BUCKET)
        .eq('project_id', projectId)
        .order('id')
    );
    files.forEach((row) => paths.add(row.path));
  } catch (error) {
    console.warn('[Storage] Não foi possível listar as imagens do quadro:', error?.message);
  }
  return [...paths];
}

// Arquivos do projeto que nenhum elemento usa mais (ex.: imagens excluídas do quadro).
// Ficam guardados enquanto a exclusão ainda pode ser desfeita; esta função os encontra.
export async function collectOrphanBoardImages(supabase, projectId, options = {}) {
  const { minAgeMs = ORPHAN_MIN_AGE_MS, paths = [] } =
    typeof options === 'number' ? { minAgeMs: options } : options;

  try {
    const cutoffMs = Date.now() - minAgeMs;
    const explicit = new Set(paths);

    const elements = await collectAll(() =>
      supabase
        .from('board_elements')
        .select('id, data')
        .eq('project_id', projectId)
        .eq('type', 'image')
        .order('id')
    );
    const inUse = new Set(
      elements.map((row) => row.data?.storagePath).filter((path) => typeof path === 'string')
    );

    const files = await collectAll(() =>
      supabase
        .from('storage_files')
        .select('id, path, created_at')
        .eq('bucket', BUCKET)
        .eq('project_id', projectId)
        .order('id')
    );

    return files
      .filter((row) => {
        if (inUse.has(row.path)) return false;
        if (explicit.has(row.path)) return true;
        const createdAt = Date.parse(row.created_at);
        return Number.isFinite(createdAt) && createdAt < cutoffMs;
      })
      .map((row) => row.path);
  } catch (error) {
    console.warn('[Storage] Não foi possível procurar imagens sem uso:', error?.message);
    return [];
  }
}

// Apaga os arquivos do Storage e os registros em "storage_files"
export async function removeBoardImages(supabase, paths) {
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + REMOVE_CHUNK);
    try {
      const { error } = await supabase.storage.from(BUCKET).remove(chunk);
      if (error) throw error;
      const { error: dbError } = await supabase
        .from('storage_files')
        .delete()
        .eq('bucket', BUCKET)
        .in('path', chunk);
      if (dbError) throw dbError;
    } catch (error) {
      console.warn('[Storage] Não foi possível apagar imagens do quadro:', error?.message);
    }
  }
}
