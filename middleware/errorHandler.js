import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Registra SEMPRE no terminal (só você vê isso)
  console.error('[ERRO]', req.method, req.originalUrl, '->', err?.name, err?.code ?? '', err?.message);

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues[0]?.message ?? 'Dados inválidos.',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido.' } });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Os dados enviados são grandes demais.' },
    });
  }

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor. Tente novamente.' },
  });
}