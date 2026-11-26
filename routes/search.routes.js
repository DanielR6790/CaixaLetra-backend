import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { search, details } from '../controllers/searchController.js';

const router = Router();

// Limite específico da busca (protege as APIs externas): 40 por minuto, por usuário.
// Esta rota fica depois do requireAuth, então "req.user" sempre existe.
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 40,
    keyGenerator: (req) => req.user.id,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: { code: 'RATE_LIMIT', message: 'Muitas buscas seguidas. Aguarde um minuto.' },
    },
  })
);

const searchQuery = z.object({
  q: z.string().trim().min(2, 'Digite ao menos 2 caracteres.').max(100, 'Busca muito longa.'),
  category: z.enum(['all', 'filmes', 'series', 'animes', 'jogos', 'outros']).default('all'),
});

const detailsQuery = z.object({
  category: z.enum(['filmes', 'series', 'animes', 'jogos']),
  // Números (IGDB, AniList) ou ID do IMDb, como tt0133093 (Cinemeta)
  id: z.string().regex(/^(tt\d{5,12}|\d{1,12})$/, 'ID inválido.'),
});

router.get('/', validate({ query: searchQuery }), search);
router.get('/details', validate({ query: detailsQuery }), details);

export default router;