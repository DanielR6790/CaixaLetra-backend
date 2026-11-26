// IGDB: jogos (API da Twitch).
// Autenticação: o backend troca o Client ID + Client Secret por um token
// temporário (cerca de 60 dias) e o guarda em memória. Se o token vencer
// ou for recusado, um novo é obtido automaticamente.
// Mesmo formato de resposta dos outros provedores.
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { fetchJson } from '../../utils/http.js';
import { remember } from '../../utils/cache.js';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API_URL = 'https://api.igdb.com/v4/games';
const IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload/t_cover_big';
const TEN_MINUTES = 10 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

const FIELDS = 'name, first_release_date, summary, genres.name, cover.image_id';

let tokenCache = null; // { token, expiresAt }
let tokenRequest = null; // evita pedir vários tokens ao mesmo tempo

function assertConfigured() {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
    throw new AppError(
      'As credenciais da IGDB não estão configuradas no .env do backend.',
      503,
      'PROVIDER_NOT_CONFIGURED'
    );
  }
}

async function requestNewToken() {
  try {
    const data = await fetchJson(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        // Enviado no corpo (e não na URL) para o segredo não ficar em endereços
        body: new URLSearchParams({
          client_id: env.IGDB_CLIENT_ID,
          client_secret: env.IGDB_CLIENT_SECRET,
          grant_type: 'client_credentials',
        }),
      },
      'Twitch (IGDB)'
    );

    // Renova 1 dia antes de vencer, por segurança
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - ONE_DAY,
    };
    return tokenCache.token;
  } catch (error) {
    if (error instanceof AppError && ['UPSTREAM_AUTH', 'UPSTREAM_ERROR'].includes(error.code)) {
      throw new AppError(
        'A Twitch recusou as credenciais da IGDB. Confira IGDB_CLIENT_ID e IGDB_CLIENT_SECRET no .env.',
        502,
        'UPSTREAM_AUTH'
      );
    }
    throw error;
  }
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  tokenRequest ??= requestNewToken().finally(() => {
    tokenRequest = null;
  });
  return tokenRequest;
}

// Envia uma consulta (linguagem "Apicalypse" da IGDB) à API
async function igdbQuery(body, canRetry = true) {
  assertConfigured();
  const token = await getAccessToken();

  try {
    return await fetchJson(
      API_URL,
      {
        method: 'POST',
        headers: {
          'Client-ID': env.IGDB_CLIENT_ID,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'text/plain',
        },
        body,
      },
      'IGDB'
    );
  } catch (error) {
    // Token recusado: descarta e tenta uma única vez com um token novo
    if (canRetry && error instanceof AppError && error.code === 'UPSTREAM_AUTH') {
      tokenCache = null;
      return igdbQuery(body, false);
    }
    throw error;
  }
}

const normalize = (game) => ({
  source: 'igdb',
  externalId: String(game.id),
  categorySlug: 'jogos',
  contentType: 'Jogo',
  title: game.name,
  // "first_release_date" vem em segundos (Unix)
  year: game.first_release_date
    ? new Date(game.first_release_date * 1000).getUTCFullYear()
    : null,
  coverUrl: game.cover?.image_id ? `${IMAGE_BASE}/${game.cover.image_id}.jpg` : null,
  description: game.summary || null,
  genres: (game.genres ?? []).map((g) => g.name),
});

export const igdb = {
  name: 'IGDB',
  categorySlug: 'jogos',

  async search(query) {
    return remember(`igdb:search:${query.toLowerCase()}`, TEN_MINUTES, async () => {
      // Escapa barras e aspas para o texto não quebrar a consulta
      const safe = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // "version_parent = null" evita listar edições repetidas do mesmo jogo
      const games = await igdbQuery(
        `search "${safe}"; fields ${FIELDS}; where version_parent = null; limit 10;`
      );
      return games.map(normalize);
    });
  },

  async details(id) {
    return remember(`igdb:details:${id}`, TEN_MINUTES, async () => {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        throw new AppError('ID inválido para a IGDB.', 400, 'INVALID_ID');
      }
      const games = await igdbQuery(`fields ${FIELDS}; where id = ${numericId}; limit 1;`);
      if (!games.length) {
        throw new AppError('Jogo não encontrado na IGDB.', 404, 'NOT_FOUND');
      }
      return normalize(games[0]);
    });
  },
};