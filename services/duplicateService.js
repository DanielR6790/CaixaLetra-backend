// Duplicar um projeto: copia o projeto, os elementos, as conexões e as imagens do quadro.
// Cada projeto fica com os PRÓPRIOS arquivos de imagem (copiados no Storage), então
// apagar um não afeta o outro.
import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import { assertNoError } from '../utils/db.js';
import { toDto } from './projectService.js';
import { removeBoardImages } from './storageCleanup.js';

const BUCKET = 'board-images';
const PAGE_SIZE = 1000;
const INSERT_CHUNK = 100;
const COPY_PARALLEL = 5;
const PROJECT_COLUMNS = 'id, name, description, board_theme, created_at, updated_at, viewport';
const SUFFIX = ' (cópia)';

const chunks = (list, size) => {
  const parts = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts;
};

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    assertNoError(error, 'Não foi possível duplicar o projeto.');
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

// "Nome" -> "Nome (cópia)", respeitando o limite de 120 caracteres
export function copyName(name) {
  const base = name.length + SUFFIX.length > 120 ? name.slice(0, 120 - SUFFIX.length).trimEnd() : name;
  return `${base}${SUFFIX}`;
}

const isNotFound = (error) =>
  String(error?.statusCode ?? error?.status ?? '') === '404' || /not.?found/i.test(error?.message ?? '');

// Copia cada arquivo de imagem para um nome novo. Devolve { caminho antigo -> { path, url } }.
// "copied" recebe os caminhos novos, para poder desfazer tudo se algo falhar.
async function copyImages(supabase, userId, newProjectId, elements, copied) {
  const paths = [
    ...new Set(
      elements
        .filter((element) => element.type === 'image' && typeof element.data?.storagePath === 'string')
        .map((element) => element.data.storagePath)
    ),
  ];
  const mapping = new Map();
  if (paths.length === 0) return mapping;

  // Tipo e tamanho dos arquivos de origem (para registrar as cópias)
  const info = new Map();
  for (const part of chunks(paths, 100)) {
    const { data, error } = await supabase
      .from('storage_files')
      .select('path, mime_type, size_bytes')
      .eq('bucket', BUCKET)
      .in('path', part);
    assertNoError(error, 'Não foi possível duplicar o projeto.');
    data.forEach((row) => info.set(row.path, row));
  }

  const failures = [];
  for (const part of chunks(paths, COPY_PARALLEL)) {
    const results = await Promise.allSettled(
      part.map(async (path) => {
        const extension = path.split('.').pop();
        const newPath = `${userId}/${randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from(BUCKET).copy(path, newPath);

        // Arquivo que já não existe: a imagem já estava quebrada, e a cópia continua igual
        if (error && isNotFound(error)) return;
        if (error) throw error;

        copied.push(newPath);
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
        mapping.set(path, { path: newPath, url: data.publicUrl });
      })
    );
    results.forEach((result) => {
      if (result.status === 'rejected') failures.push(result.reason);
    });
  }

  if (failures.length > 0) {
    console.error('[Storage]', failures[0]?.message ?? failures[0]);
    throw new AppError('Não foi possível copiar as imagens do quadro.', 502, 'STORAGE_ERROR');
  }

  // Registro das cópias (usado na limpeza futura). Falhar aqui não impede a duplicação.
  const rows = [...mapping.entries()].map(([oldPath, file]) => ({
    user_id: userId,
    bucket: BUCKET,
    path: file.path,
    mime_type: info.get(oldPath)?.mime_type ?? null,
    size_bytes: info.get(oldPath)?.size_bytes ?? null,
    project_id: newProjectId,
  }));
  for (const part of chunks(rows, INSERT_CHUNK)) {
    const { error } = await supabase.from('storage_files').insert(part);
    if (error) console.warn('[Storage] Registro das cópias falhou:', error.message);
  }

  return mapping;
}

export async function duplicateProject(supabase, userId, projectId) {
  const { data: source, error: sourceError } = await supabase
    .from('projects')
    .select('id, name, description, board_theme, viewport')
    .eq('id', projectId)
    .maybeSingle();
  assertNoError(sourceError, 'Não foi possível carregar o projeto.');
  if (!source) throw new AppError('Projeto não encontrado.', 404, 'NOT_FOUND');

  const elements = await fetchAll(() =>
    supabase
      .from('board_elements')
      .select('id, type, x, y, width, height, z_index, data')
      .eq('project_id', projectId)
      .order('id')
  );
  const connections = await fetchAll(() =>
    supabase
      .from('board_connections')
      .select('id, source_element_id, target_element_id, label, data')
      .eq('project_id', projectId)
      .order('id')
  );

  const { data: created, error: createError } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: copyName(source.name),
      description: source.description,
      board_theme: source.board_theme,
      viewport: source.viewport,
    })
    .select(PROJECT_COLUMNS)
    .single();
  assertNoError(createError, 'Não foi possível duplicar o projeto.');

  const copiedFiles = [];
  try {
    const mapping = await copyImages(supabase, userId, created.id, elements, copiedFiles);
    const idMap = new Map(elements.map((element) => [element.id, randomUUID()]));

    const elementRows = elements.map((element) => {
      let data = element.data;
      if (element.type === 'image') {
        const file = mapping.get(element.data?.storagePath);
        if (file) data = { ...element.data, url: file.url, storagePath: file.path };
      }
      return {
        id: idMap.get(element.id),
        project_id: created.id,
        user_id: userId,
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        z_index: element.z_index,
        data,
      };
    });
    for (const part of chunks(elementRows, INSERT_CHUNK)) {
      const { error } = await supabase.from('board_elements').insert(part);
      assertNoError(error, 'Não foi possível duplicar o projeto.');
    }

    const connectionRows = connections
      .filter((c) => idMap.has(c.source_element_id) && idMap.has(c.target_element_id))
      .map((c) => ({
        id: randomUUID(),
        project_id: created.id,
        user_id: userId,
        source_element_id: idMap.get(c.source_element_id),
        target_element_id: idMap.get(c.target_element_id),
        label: c.label,
        data: c.data,
      }));
    for (const part of chunks(connectionRows, INSERT_CHUNK)) {
      const { error } = await supabase.from('board_connections').insert(part);
      assertNoError(error, 'Não foi possível duplicar o projeto.');
    }
  } catch (error) {
    // Desfaz: não deixa uma cópia pela metade (elementos e conexões somem junto, em cascata)
    try {
      await supabase.from('projects').delete().eq('id', created.id);
      await removeBoardImages(supabase, copiedFiles);
    } catch (cleanupError) {
      console.warn('[duplicate] Falha ao desfazer a cópia:', cleanupError?.message);
    }
    throw error;
  }

  return toDto(created);
}
