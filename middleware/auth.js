import { createHash } from 'node:crypto';
import { createAnonClient, createUserClient } from '../config/supabase.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Exige um usuário logado. O frontend envia o cabeçalho:
//   Authorization: Bearer <token>
// Se o token for válido, a rota recebe:
//   req.user      -> dados do usuário
//   req.supabase  -> conexão ao banco "como esse usuário" (respeita o RLS)
//
// Para não consultar o Supabase Auth a cada requisição, a validação de um token
// fica guardada por até 30 segundos (e nunca além da validade do próprio token).
// Contrapartida: uma sessão encerrada pode continuar valendo por até 30 s.
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 1000;
const cache = new Map(); // sha256(token) -> { user, expiresAt }

// Lê o "exp" (validade) do token. Devolve 0 se não conseguir ler.
function tokenExpiresAtMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.user;
}

function writeCache(key, user, token) {
  const tokenExp = tokenExpiresAtMs(token);
  if (!tokenExp) return; // sem validade legível: não guarda
  const expiresAt = Math.min(Date.now() + CACHE_TTL_MS, tokenExp);
  if (expiresAt <= Date.now()) return;

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { user, expiresAt });
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Você precisa estar logado.', 401, 'UNAUTHENTICATED');
  }

  const key = createHash('sha256').update(token).digest('hex');
  let user = readCache(key);

  if (!user) {
    const { data, error } = await createAnonClient().auth.getUser(token);

    // Falha de conexão com o Supabase não é "sessão inválida"
    if (error && (error.name === 'AuthRetryableFetchError' || (error.status ?? 0) >= 500)) {
      throw new AppError(
        'Serviço de autenticação indisponível. Tente novamente em instantes.',
        503,
        'AUTH_UNAVAILABLE'
      );
    }
    if (error || !data?.user) {
      throw new AppError('Sessão inválida ou expirada. Faça login novamente.', 401, 'INVALID_TOKEN');
    }

    user = data.user;
    writeCache(key, user, token);
  }

  req.user = user;
  req.accessToken = token;
  req.supabase = createUserClient(token);
  next();
});