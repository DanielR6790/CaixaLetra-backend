import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { getMe, updateMe } from '../controllers/userController.js';

const router = Router();

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const updateBody = z
  .object({
    // Mesma regra do cadastro e do banco
    username: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{3,30}$/, 'Use de 3 a 30 caracteres: letras, números e _ (sem espaços ou acentos).')
      .optional(),
    timezone: z
      .string()
      .trim()
      .min(1, 'Informe o fuso horário.')
      .max(64, 'Fuso horário inválido.')
      .refine(isValidTimeZone, 'Fuso horário inválido.')
      .optional(),
    // null remove a foto. O serviço confere que o endereço é da pasta do próprio usuário.
    avatarUrl: z.string().trim().max(2000, 'Endereço da foto muito longo.').nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Nenhuma alteração informada.',
  });

router.get('/', getMe);
router.patch('/', validate({ body: updateBody }), updateMe);

export default router;