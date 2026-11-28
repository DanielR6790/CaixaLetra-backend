import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { exportData, remove } from '../controllers/accountController.js';

const router = Router();

// Limites por usuário, por hora. Esta rota fica depois do requireAuth, então "req.user" existe.
// O limite da exclusão também protege contra tentativas de adivinhar a senha.
const hourlyLimit = (limit, message) =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit,
    keyGenerator: (req) => req.user.id,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message } },
  });

const deleteBody = z.object({
  password: z.string().min(1, 'Digite sua senha.').max(200, 'Senha inválida.'),
});

router.get('/export', hourlyLimit(10, 'Muitas exportações seguidas. Tente novamente mais tarde.'), exportData);
router.post(
  '/delete',
  hourlyLimit(5, 'Muitas tentativas. Tente novamente mais tarde.'),
  validate({ body: deleteBody }),
  remove
);

export default router;