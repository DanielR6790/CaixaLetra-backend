// REGISTRO DOS PROVEDORES DE BUSCA.
// Para adicionar uma API nova no futuro:
//   1. Crie um arquivo aqui (ex.: openlibrary.js) com { name, categorySlug, search(q), details(id) }.
//   2. Registre-o abaixo, ligando-o a uma categoria.
import { cinemetaMovies, cinemetaSeries } from './cinemeta.js';
import { igdb } from './igdb.js';
import { anilist } from './anilist.js';

export const providersByCategory = {
  filmes: cinemetaMovies,
  series: cinemetaSeries,
  animes: anilist,
  jogos: igdb,
};