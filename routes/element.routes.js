import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { limitArrays } from '../middleware/limitArrays.js';
import { list, sync } from '../controllers/elementController.js';

// mergeParams: recebe o ":id" do projeto definido em routes/index.js
const router = Router({ mergeParams: true });

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.');

const coordinate = z
  .number({ invalid_type_error: 'Posição inválida.' })
  .finite()
  .min(-10_000_000, 'Posição inválida.')
  .max(10_000_000, 'Posição inválida.');

const dimension = z
  .number({ invalid_type_error: 'Tamanho inválido.' })
  .finite()
  .gt(0, 'Tamanho inválido.')
  .max(20000, 'Tamanho inválido.');

const base = {
  id: z.string().uuid('ID inválido.'),
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
  zIndex: z.number().int().min(-1_000_000).max(1_000_000).default(0),
};

// Dados de uma caixa de texto (campos desconhecidos são descartados)
const textData = z.object({
  text: z.string().max(20000, 'O texto pode ter no máximo 20000 caracteres.').default(''),
  fontSize: z.number().int().min(8, 'Fonte inválida.').max(200, 'Fonte inválida.').default(18),
  color: hexColor.nullable().default(null), // null = automática (segue o tema do quadro)
  background: hexColor.nullable().default(null), // null = sem fundo
  align: z.enum(['left', 'center', 'right'], { message: 'Alinhamento inválido.' }).default('left'),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
});

// Dados de uma imagem: endereço público + caminho do arquivo no Storage
const imageData = z.object({
  url: z
    .string()
    .max(2000, 'Endereço da imagem muito longo.')
    .refine((value) => /^https?:\/\//i.test(value), 'Endereço da imagem inválido.'),
  storagePath: z
    .string()
    .regex(
      /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i,
      'Caminho da imagem inválido.'
    ),
});

const elementSchema = z.discriminatedUnion(
  'type',
  [
    z.object({ ...base, type: z.literal('text'), data: textData }),
    z.object({ ...base, type: z.literal('image'), data: imageData }),
  ],
  { errorMap: () => ({ message: 'Tipo de elemento inválido.' }) }
);

const idParams = z.object({ id: z.string().uuid('ID inválido.') });

const syncBody = z.object({
  upsert: z.array(elementSchema).max(50, 'Alterações demais de uma vez.').default([]),
  remove: z.array(z.string().uuid('ID inválido.')).max(100, 'Alterações demais de uma vez.').default([]),
});

router.get('/', validate({ params: idParams }), list);
router.post(
  '/sync',
  limitArrays({ upsert: 50, remove: 100 }),
  validate({ params: idParams, body: syncBody }),
  sync
);

export default router;