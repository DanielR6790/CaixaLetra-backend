import { AppError } from '../utils/AppError.js';

// Barra listas grandes demais no corpo da requisição ANTES de o zod validar.
// Motivo: o zod (versões 3.x) processa todos os itens de uma lista antes de conferir
// o tamanho dela, e uma lista gigante pode esgotar a memória (GHSA-mrhx-c7xc-m3w5).
// Uso: limitArrays({ upsert: 50, remove: 100 })
export const limitArrays = (limits) => (req, res, next) => {
  for (const [field, max] of Object.entries(limits)) {
    const value = req.body?.[field];
    if (Array.isArray(value) && value.length > max) {
      return next(new AppError('Alterações demais de uma vez.', 400, 'VALIDATION_ERROR'));
    }
  }
  next();
};