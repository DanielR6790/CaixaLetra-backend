import { providersByCategory } from './providers/index.js';
import { AppError } from '../utils/AppError.js';

// Busca uma obra. Com category = "all", consulta todas as APIs ao mesmo tempo.
// Se uma API falhar na busca geral, as outras continuam funcionando.
export async function searchContent({ query, category }) {
  if (category === 'outros') {
    return { results: [], warnings: [], manualOnly: true };
  }

  if (category !== 'all') {
    const provider = providersByCategory[category];
    if (!provider) {
      throw new AppError('Esta categoria não possui busca automática.', 400, 'NO_PROVIDER');
    }
    return { results: await provider.search(query), warnings: [], manualOnly: false };
  }

  const entries = Object.values(providersByCategory);
  const settled = await Promise.allSettled(entries.map((provider) => provider.search(query)));

  const results = [];
  const warnings = [];

  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
    } else {
      warnings.push({
        provider: entries[index].name,
        message: outcome.reason?.message ?? 'Falha na busca.',
      });
    }
  });

  return { results, warnings, manualOnly: false };
}

// Dados completos de uma obra escolhida na lista de resultados
export async function getContentDetails({ category, id }) {
  const provider = providersByCategory[category];
  if (!provider) {
    throw new AppError('Esta categoria não possui busca automática.', 400, 'NO_PROVIDER');
  }
  return provider.details(id);
}
