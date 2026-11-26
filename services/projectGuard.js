import { AppError } from '../utils/AppError.js';
import { assertNoError } from '../utils/db.js';

// Confirma que o projeto existe e pertence ao usuário (o RLS esconde os dos outros).
export async function assertProjectExists(supabase, projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();
  assertNoError(error, 'Não foi possível carregar o projeto.');
  if (!data) throw new AppError('Projeto não encontrado.', 404, 'NOT_FOUND');
}