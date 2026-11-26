// Cinemeta: filmes e séries (catálogo de metadados do Stremio).
// Não precisa de chave de API. Os IDs são do IMDb (ex.: tt0133093).
// Mesmo formato de resposta dos outros provedores.
import { fetchJson } from '../../utils/http.js';
import { remember } from '../../utils/cache.js';
import { parseYear } from '../../utils/normalize.js';
import { AppError } from '../../utils/AppError.js';

const BASE = 'https://v3-cinemeta.strem.io';
const TEN_MINUTES = 10 * 60 * 1000;
const IMDB_ID = /^tt\d{5,12}$/;

function createCinemetaProvider(type) {
  const isMovie = type === 'movie';

  const normalize = (item) => ({
    source: 'cinemeta',
    externalId: String(item.imdb_id ?? item.id),
    categorySlug: isMovie ? 'filmes' : 'series',
    contentType: isMovie ? 'Filme' : 'Série',
    title: item.name || 'Sem título',
    // "releaseInfo" pode ser "1999" ou "2008–2013"; pegamos o primeiro ano
    year: parseYear(item.releaseInfo) ?? parseYear(item.year),
    coverUrl: item.poster || null,
    description: item.description || null,
    genres: Array.isArray(item.genres) ? item.genres : [],
  });

  return {
    name: 'Cinemeta',
    categorySlug: isMovie ? 'filmes' : 'series',

    async search(query) {
      return remember(`cinemeta:${type}:search:${query.toLowerCase()}`, TEN_MINUTES, async () => {
        const url = `${BASE}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
        const data = await fetchJson(url, { headers: { accept: 'application/json' } }, 'Cinemeta');
        return (data.metas ?? []).slice(0, 10).map(normalize);
      });
    },

    async details(id) {
      if (!IMDB_ID.test(id)) {
        throw new AppError('ID inválido para o Cinemeta.', 400, 'INVALID_ID');
      }
      return remember(`cinemeta:${type}:details:${id}`, TEN_MINUTES, async () => {
        const url = `${BASE}/meta/${type}/${id}.json`;
        const data = await fetchJson(url, { headers: { accept: 'application/json' } }, 'Cinemeta');
        if (!data.meta) {
          throw new AppError('Conteúdo não encontrado no Cinemeta.', 404, 'NOT_FOUND');
        }
        return normalize(data.meta);
      });
    },
  };
}

export const cinemetaMovies = createCinemetaProvider('movie');
export const cinemetaSeries = createCinemetaProvider('series');