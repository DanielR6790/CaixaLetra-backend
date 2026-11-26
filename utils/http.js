import { AppError } from './AppError.js';

// Faz uma requisição a uma API externa com limite de tempo e erros claros.
// IMPORTANTE: nunca registra a URL, porque ela pode conter a chave da API.
export async function fetchJson(url, options = {}, serviceName = 'API externa') {
  let response;

  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new AppError(
      `${serviceName} não respondeu. Tente novamente em instantes.`,
      502,
      'UPSTREAM_UNAVAILABLE'
    );
  }

  if (!response.ok) {
    console.error(`[${serviceName}] respondeu com status ${response.status}`);

    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        `${serviceName} recusou a chave de acesso. Confira as credenciais no arquivo .env.`,
        502,
        'UPSTREAM_AUTH'
      );
    }
    if (response.status === 404) {
      throw new AppError('Conteúdo não encontrado na API externa.', 404, 'NOT_FOUND');
    }
    if (response.status === 429) {
      throw new AppError(
        `${serviceName} recebeu muitas requisições. Aguarde um pouco.`,
        429,
        'UPSTREAM_RATE_LIMIT'
      );
    }
    throw new AppError(`${serviceName} retornou um erro.`, 502, 'UPSTREAM_ERROR');
  }

  return response.json();
}