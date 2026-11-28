import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { AppError } from './utils/AppError.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

// Em hospedagens (Render, Railway etc.) o servidor fica atrás de um proxy
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Sem ETag: evita respostas "304" reaproveitadas do cache do navegador
app.set('etag', false);
app.disable('x-powered-by');

app.use(helmet());

// CORS: só o seu frontend pode chamar esta API pelo navegador
const allowedOrigins = env.FRONTEND_URL.split(',').map((url) => url.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new AppError('Origem não permitida.', 403, 'CORS_FORBIDDEN'));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  })
);

app.use(express.json({ limit: '1mb' }));

// Página de apresentação da API (quem abre o link do backend no navegador vê isto)
app.get('/', (req, res) => {
  res.json({
    name: 'API do CaixaLetra',
    status: 'online',
    health: '/api/health',
  });
});

// Dados de cada usuário nunca devem ficar guardados em cache
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Limite geral por IP: 600 requisições por minuto.
// Folgado para o salvamento automático do quadro, mas barra abusos.
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: { code: 'RATE_LIMIT', message: 'Muitas requisições. Aguarde um instante.' },
    },
  })
);

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

// Se algo escapar do tratamento normal, registra no terminal em vez de
// derrubar o servidor em silêncio
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
});

app.listen(env.PORT, () => {
  console.log(`✅ Backend rodando na porta ${env.PORT}`);
});