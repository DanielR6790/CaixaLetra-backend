// Lê e valida as variáveis de ambiente.
// Ordem de leitura (a primeira que definir uma variável vence):
//   1) backend/.env        (repositório do backend)
//   2) ../.env             (pasta de trabalho antiga, na raiz)
// Em hospedagem (Render) não há arquivo: as variáveis vêm do painel do serviço.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Valores que ainda estão como "COLE_AQUI..." são tratados como vazios
const raw = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [
    key,
    typeof value === 'string' && value.startsWith('COLE_AQUI') ? undefined : value,
  ])
);

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Pode ter mais de um endereço, separados por vírgula
  FRONTEND_URL: z.string().min(1, 'FRONTEND_URL é obrigatório.'),
  SUPABASE_URL: z.string().url('SUPABASE_URL precisa ser a URL do seu projeto Supabase.'),
  SUPABASE_ANON_KEY: z.string().min(20, 'SUPABASE_ANON_KEY não foi preenchida.'),
  IGDB_CLIENT_ID: z.string().optional(),
  IGDB_CLIENT_SECRET: z.string().optional(),
});

const result = schema.safeParse(raw);

if (!result.success) {
  console.error('\n❌ Configuração inválida nas variáveis de ambiente:\n');
  for (const issue of result.error.issues) {
    console.error(`   • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error(
    '\nLocalmente, confira o arquivo ".env.example". Na hospedagem, confira as variáveis do painel.\n'
  );
  process.exit(1);
}

export const env = result.data;

if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
  console.warn('⚠️  Credenciais da IGDB não definidas: busca de jogos desativada.');
}