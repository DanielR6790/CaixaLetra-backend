import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { getCategories } from '../controllers/userController.js';
import meRoutes from './me.routes.js';
import accountRoutes from './account.routes.js';
import searchRoutes from './search.routes.js';
import contentRoutes from './content.routes.js';
import projectRoutes from './project.routes.js';
import elementRoutes from './element.routes.js';
import connectionRoutes from './connection.routes.js';

const router = Router();

// ---- Rotas públicas ----
router.get('/', (req, res) => {
  res.json({
    name: 'API do catálogo e da organização de ideias',
    status: 'online',
    health: '/api/health',
    note: 'As demais rotas exigem login e são usadas pelo site.',
  });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    providers: {
      cinemeta: true, // não precisa de chave
      igdb: Boolean(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET),
      anilist: true, // não precisa de chave
    },
  });
});

// ---- Rotas privadas (exigem login) ----
router.use(requireAuth);
router.use('/me', meRoutes);
router.use('/account', accountRoutes);
router.get('/categories', getCategories);
router.use('/search', searchRoutes);
router.use('/contents', contentRoutes);
// Elementos e conexões vêm ANTES de "/projects", porque o caminho deles é mais específico
router.use('/projects/:id/elements', elementRoutes);
router.use('/projects/:id/connections', connectionRoutes);
router.use('/projects', projectRoutes);

export default router;