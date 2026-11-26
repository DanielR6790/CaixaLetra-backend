import { AppError } from './AppError.js';

// Se o Supabase devolveu erro, registra o detalhe no terminal (só para você)
// e lança um erro com mensagem genérica para o usuário.
export function assertNoError(error, userMessage = 'Erro ao acessar o banco de dados.') {
  if (!error) return;
  console.error('[DB]', error.code ?? '', error.message);

  // Limites de uso definidos no banco (hardening.sql): a mensagem já é clara
  if (error.code === '23514' && /^Limite de /.test(error.message ?? '')) {
    throw new AppError(error.message, 409, 'LIMIT_REACHED');
  }

  throw new AppError(userMessage, 500, 'DB_ERROR');
}