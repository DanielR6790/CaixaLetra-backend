import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import {
  list,
  create,
  update,
  remove,
  saveReview,
  removeReview,
} from '../controllers/contentController.js';

const router = Router();

const CATEGORIES = ['filmes', 'series', 'animes', 'jogos', 'outros'];

// Cada origem só vale para as categorias que ela atende
const SOURCE_CATEGORIES = {
  cinemeta: ['filmes', 'series'],
  igdb: ['jogos'],
  anilist: ['animes'],
};

const emptyToNull = (value) => (typeof value === 'string' && value.trim() === '' ? null : value);

const optionalText = (max) =>
  z.preprocess(
    emptyToNull,
    z.string().trim().max(max, `Texto muito longo (máximo de ${max} caracteres).`).nullable().optional()
  );

const yearField = z.preprocess(
  emptyToNull,
  z.coerce
    .number({ invalid_type_error: 'Ano inválido.' })
    .int('Ano inválido.')
    .min(1800, 'Ano inválido.')
    .max(2200, 'Ano inválido.')
    .nullable()
    .optional()
);

const coverField = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(2000, 'Endereço da capa muito longo.')
    .refine((url) => /^https?:\/\//i.test(url), 'Endereço da capa inválido.')
    .nullable()
    .optional()
);

const ratingField = z.coerce
  .number({ invalid_type_error: 'Nota inválida.' })
  .int('A nota deve ser um número inteiro.')
  .min(1, 'A nota deve ser de 1 a 10.')
  .max(10, 'A nota deve ser de 1 a 10.');

// "all" = todas as categorias (usado pela Linha do tempo)
const listQuery = z.object({
  category: z.enum([...CATEGORIES, 'all'], { message: 'Categoria inválida.' }),
});

const idParams = z.object({ id: z.string().uuid('ID inválido.') });

const createBody = z
  .object({
    categorySlug: z.enum(CATEGORIES, { message: 'Categoria inválida.' }),
    title: z.string().trim().min(1, 'Informe o título.').max(300, 'Título muito longo.'),
    releaseYear: yearField,
    genre: optionalText(200),
    description: optionalText(10000),
    contentType: optionalText(60),
    coverUrl: coverField,
    source: z.enum(['manual', 'cinemeta', 'igdb', 'anilist']).default('manual'),
    externalId: z.string().trim().min(1).max(50).optional(),
    destination: z.enum(['lista', 'avaliado']).default('lista'),
    rating: ratingField.optional(),
    reviewText: optionalText(20000),
  })
  .superRefine((data, ctx) => {
    if (data.source !== 'manual') {
      if (!data.externalId) {
        ctx.addIssue({ code: 'custom', path: ['externalId'], message: 'ID da obra ausente.' });
      }
      if (!SOURCE_CATEGORIES[data.source].includes(data.categorySlug)) {
        ctx.addIssue({
          code: 'custom',
          path: ['source'],
          message: 'Esta origem não atende a categoria escolhida.',
        });
      }
    }
    if (data.destination === 'avaliado' && data.rating === undefined) {
      ctx.addIssue({ code: 'custom', path: ['rating'], message: 'Informe uma nota de 1 a 10.' });
    }
  });

const updateBody = z
  .object({
    title: z.string().trim().min(1, 'Informe o título.').max(300, 'Título muito longo.').optional(),
    releaseYear: yearField,
    genre: optionalText(200),
    description: optionalText(10000),
    contentType: optionalText(60),
    coverUrl: coverField,
    status: z.enum(['para_consumir', 'consumido']).optional(),
    isFavorite: z.boolean({ invalid_type_error: 'Valor inválido para favorito.' }).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Nenhuma alteração informada.',
  });

const reviewBody = z.object({
  rating: ratingField,
  reviewText: optionalText(20000),
});

const deleteReviewQuery = z.object({
  toList: z.enum(['true', 'false']).default('false'),
});

router.get('/', validate({ query: listQuery }), list);
router.post('/', validate({ body: createBody }), create);
router.patch('/:id', validate({ params: idParams, body: updateBody }), update);
router.delete('/:id', validate({ params: idParams }), remove);

router.put('/:id/review', validate({ params: idParams, body: reviewBody }), saveReview);
router.delete(
  '/:id/review',
  validate({ params: idParams, query: deleteReviewQuery }),
  removeReview
);

export default router;