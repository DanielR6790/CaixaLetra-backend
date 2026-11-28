import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { list, get, create, update, remove, duplicate } from '../controllers/projectController.js';

const router = Router();

const emptyToNull = (value) => (typeof value === 'string' && value.trim() === '' ? null : value);

const nameField = z
  .string({ invalid_type_error: 'Nome inválido.' })
  .trim()
  .min(1, 'Informe o nome do projeto.')
  .max(120, 'O nome pode ter no máximo 120 caracteres.');

const descriptionField = z.preprocess(
  emptyToNull,
  z.string().trim().max(2000, 'A descrição pode ter no máximo 2000 caracteres.').nullable().optional()
);

// Posição e zoom do quadro. Os limites evitam valores absurdos.
const viewportField = z.object({
  x: z.number().finite().min(-10_000_000).max(10_000_000),
  y: z.number().finite().min(-10_000_000).max(10_000_000),
  zoom: z.number().finite().min(0.05).max(5),
});

const idParams = z.object({ id: z.string().uuid('ID inválido.') });

const createBody = z.object({
  name: nameField,
  description: descriptionField,
});

const updateBody = z
  .object({
    name: nameField.optional(),
    description: descriptionField,
    boardTheme: z.enum(['dark', 'light'], { message: 'Tema do quadro inválido.' }).optional(),
    viewport: viewportField.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Nenhuma alteração informada.',
  });

// Duplicar é pesado (copia elementos e imagens): 20 por hora, por usuário.
// Esta rota fica depois do requireAuth, então "req.user" existe.
const duplicateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user.id,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMIT', message: 'Muitas duplicações seguidas. Tente novamente mais tarde.' },
  },
});

router.get('/', list);
router.post('/', validate({ body: createBody }), create);
router.get('/:id', validate({ params: idParams }), get);
router.patch('/:id', validate({ params: idParams, body: updateBody }), update);
router.delete('/:id', validate({ params: idParams }), remove);
router.post('/:id/duplicate', duplicateLimit, validate({ params: idParams }), duplicate);

export default router;
