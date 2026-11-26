// =====================================================================
// seed-board.js | Cria um quadro grande para testar desempenho.
// Uso:  npm run seed:board            (300 elementos)
//       npm run seed:board -- 800     (800 elementos; mínimo 10, máximo 1500)
// Usa a conta de teste A (variáveis TEST_A_EMAIL e TEST_A_PASSWORD).
// =====================================================================
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const API = `http://localhost:${env.PORT}/api`;
const total = Math.min(Math.max(Number(process.argv[2]) || 300, 10), 1500);

async function api(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? `Erro ${response.status}`);
  return json;
}

const chunks = (list, size) => {
  const parts = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts;
};

async function main() {
  const { TEST_A_EMAIL: email, TEST_A_PASSWORD: password } = process.env;
  if (!email || !password) {
    console.error('Defina TEST_A_EMAIL e TEST_A_PASSWORD (veja as instruções da Etapa 9).');
    process.exit(2);
  }

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login falhou: ${error.message}`);
  const token = data.session.access_token;

  const started = Date.now();
  const { project } = await api(token, 'POST', '/projects', {
    name: `TESTE de desempenho (${total} elementos)`,
    description: 'Criado pelo script seed-board. Pode excluir depois.',
  });

  const elements = Array.from({ length: total }, (_, index) => ({
    id: randomUUID(),
    type: 'text',
    x: (index % 20) * 300,
    y: Math.floor(index / 20) * 160,
    width: 240,
    height: 100,
    zIndex: index,
    data: {
      text: `Caixa ${index + 1}`, fontSize: 18, color: null, background: null,
      align: 'left', bold: false, italic: false,
    },
  }));

  for (const part of chunks(elements, 10)) {
    await api(token, 'POST', `/projects/${project.id}/elements/sync`, { upsert: part, remove: [] });
  }

  // Corrente de setas: 1 -> 2 -> 3 -> ...
  const connections = elements.slice(1).map((element, index) => ({
    id: randomUUID(), sourceId: elements[index].id, targetId: element.id,
  }));
  for (const part of chunks(connections, 50)) {
    await api(token, 'POST', `/projects/${project.id}/connections/sync`, { upsert: part, remove: [] });
  }

  console.log(`Pronto em ${((Date.now() - started) / 1000).toFixed(1)} s: ${total} elementos e ${connections.length} conexões.`);
  console.log(`Entre no site com a conta de teste A e abra:  http://localhost:5173/ideias/${project.id}`);
}

main().catch((error) => {
  console.error('Erro:', error.message);
  process.exit(1);
});