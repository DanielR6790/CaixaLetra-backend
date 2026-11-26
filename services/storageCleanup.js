// Limpeza das imagens dos quadros no Supabase Storage (bucket "board-images").
// Feita no "melhor esforço": se falhar, só registra no terminal, sem
// impedir a exclusão que o usuário pediu.
const BUCKET = 'board-images';
const PAGE_SIZE = 1000;
const REMOVE_CHUNK = 100;

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

// Apaga os arquivos do Storage e os registros em "storage_files"
export async function removeBoardImages(supabase, paths) {
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + REMOVE_CHUNK);
    try {
      const { error } = await supabase.storage.from(BUCKET).remove(chunk);
      if (error) throw error;
      await supabase.from('storage_files').delete().eq('bucket', BUCKET).in('path', chunk);
    } catch (error) {
      console.warn('[Storage] Não foi possível apagar imagens do quadro:', error?.message);
    }
  }
}