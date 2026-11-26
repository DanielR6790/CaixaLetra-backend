import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { list, sync } from '../controllers/connectionController.js';

// mergeParams: recebe o ":id" do projeto definido em routes/index.js
const router = Router({ mergeParams: true });

const uuid = z.string().uuid('ID inválido.');

const connectionSchema = z
  .object({ id: uuid, sourceId: uuid, targetId: uuid })
  .refine((connection) => connection.sourceId !== connection.targetId, {
    message: 'Escolha dois elementos diferentes.',
  });

const idParams = z.object({ id: uuid });

const syncBody = z.object({
  upsert: z.array(connectionSchema).max(50, 'Alterações demais de uma vez.').default([]),
  remove: z.array(uuid).max(100, 'Alterações demais de uma vez.').default([]),
});

router.get('/', validate({ params: idParams }), list);
router.post('/sync', validate({ params: idParams, body: syncBody }), sync);

export default router;