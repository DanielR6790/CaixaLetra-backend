// AniList: animes (API GraphQL, sem chave para buscas públicas).
import { AppError } from '../../utils/AppError.js';
import { fetchJson } from '../../utils/http.js';
import { remember } from '../../utils/cache.js';
import { stripHtml } from '../../utils/normalize.js';

const ENDPOINT = 'https://graphql.anilist.co';
const TEN_MINUTES = 10 * 60 * 1000;

const MEDIA_FIELDS = `
  id
  title { romaji english }
  startDate { year }
  format
  coverImage { large }
  description(asHtml: false)
  genres
`;

const SEARCH_QUERY = `
  query ($search: String, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const DETAILS_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      ${MEDIA_FIELDS}
    }
  }
`;

const FORMATS = {
  TV: 'Série de TV',
  TV_SHORT: 'Série curta',
  MOVIE: 'Filme',
  SPECIAL: 'Especial',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Clipe musical',
};

const normalize = (media) => ({
  source: 'anilist',
  externalId: String(media.id),
  categorySlug: 'animes',
  contentType: FORMATS[media.format] ?? 'Anime',
  title: media.title?.english || media.title?.romaji || 'Sem título',
  year: media.startDate?.year ?? null,
  coverUrl: media.coverImage?.large ?? null,
  description: stripHtml(media.description),
  genres: media.genres ?? [],
});

async function graphql(query, variables) {
  const data = await fetchJson(
    ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    'AniList'
  );
  if (data.errors?.length) {
    throw new AppError('AniList retornou um erro.', 502, 'UPSTREAM_ERROR');
  }
  return data.data;
}

export const anilist = {
  name: 'AniList',
  categorySlug: 'animes',

  async search(query) {
    return remember(`anilist:search:${query.toLowerCase()}`, TEN_MINUTES, async () => {
      const data = await graphql(SEARCH_QUERY, { search: query, perPage: 10 });
      return (data.Page?.media ?? []).map(normalize);
    });
  },

  async details(id) {
    return remember(`anilist:details:${id}`, TEN_MINUTES, async () => {
      const data = await graphql(DETAILS_QUERY, { id: Number(id) });
      return normalize(data.Media);
    });
  },
};