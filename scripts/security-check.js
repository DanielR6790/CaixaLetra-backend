// =====================================================================
// security-check.js | Teste automático de segurança (Etapa 9)
//
// Usa DUAS contas de teste para provar que uma conta não consegue ver, alterar
// ou apagar os dados da outra (pela API e direto no banco), que o banco recusa
// dados inválidos e que visitantes sem login ficam de fora.
//
// As contas vêm de variáveis de ambiente (nunca ficam em arquivo):
//   TEST_A_EMAIL, TEST_A_PASSWORD, TEST_B_EMAIL, TEST_B_PASSWORD
// Use SOMENTE contas de teste: o script cria e apaga dados nelas.
// =====================================================================
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const API = `http://localhost:${env.PORT}/api`;
const stats = { passed: 0, failed: 0 };

// PNG de 1x1 pixel, usado nos testes de upload
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// ---------------------------------------------------------------- utilitários
function section(title) {
  console.log(`\n${title}`);
}

function check(name, ok, detail = '') {
  if (ok) {
    stats.passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    stats.failed += 1;
    console.log(`  ❌ ${name}${detail ? `  →  ${detail}` : ''}`);
  }
}

async function api(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // resposta sem corpo
  }
  return { status: response.status, json, headers: response.headers };
}

// Requisição "crua", para poder escolher o cabeçalho Origin (teste de CORS)
function rawGet(path, origin) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: 'localhost',
        port: env.PORT,
        path: `/api${path}`,
        method: 'GET',
        headers: origin ? { Origin: origin } : {},
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }));
      }
    );
    request.on('error', reject);
    request.end();
  });
}

function newClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signIn(email, password) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login falhou para ${email}: ${error.message}`);
  return { client, token: data.session.access_token, id: data.user.id };
}

const textElement = (id, x, text = 'segredo de A') => ({
  id,
  type: 'text',
  x,
  y: 0,
  width: 200,
  height: 100,
  zIndex: 1,
  data: { text, fontSize: 18, color: null, background: null, align: 'left', bold: false, italic: false },
});

const noRows = (result) => !result.error && (result.data ?? []).length === 0;

// ------------------------------------------------------------------- testes
async function runChecks(A, B, created) {
  // 1 ---------------------------------------------------------------------
  section('1. Visitante sem login');
  const anon = newClient();
  for (const table of [
    'profiles', 'categories', 'contents', 'reviews', 'projects',
    'board_elements', 'board_connections', 'storage_files',
  ]) {
    const result = await anon.from(table).select('*').limit(1);
    check(`não lê a tabela "${table}"`, Boolean(result.error) || (result.data ?? []).length === 0);
  }
  let r = await api(null, 'GET', '/me');
  check('API: /me sem token responde 401', r.status === 401, `status ${r.status}`);
  r = await api('token-falso', 'GET', '/projects');
  check('API: token falso responde 401', r.status === 401, `status ${r.status}`);
  r = await api(null, 'GET', '/health');
  check('API: /health é público', r.status === 200, `status ${r.status}`);

  // 2 ---------------------------------------------------------------------
  section('2. Preparando dados da conta A');
  r = await api(A.token, 'POST', '/projects', { name: 'SEC-TEST projeto de A' });
  check('A cria um projeto', r.status === 201, `status ${r.status}`);
  if (r.status !== 201) throw new Error('Não foi possível preparar os dados de teste.');
  const projectId = r.json.project.id;
  created.projectId = projectId;

  const e1 = randomUUID();
  const e2 = randomUUID();
  r = await api(A.token, 'POST', `/projects/${projectId}/elements/sync`, {
    upsert: [textElement(e1, 0), textElement(e2, 300)],
    remove: [],
  });
  check('A salva 2 elementos no quadro', r.status === 200, `status ${r.status}`);

  const connId = randomUUID();
  r = await api(A.token, 'POST', `/projects/${projectId}/connections/sync`, {
    upsert: [{ id: connId, sourceId: e1, targetId: e2 }],
    remove: [],
  });
  check('A salva 1 conexão', r.status === 200, `status ${r.status}`);

  const title = `SEC-TEST ${randomUUID().slice(0, 8)}`;
  r = await api(A.token, 'POST', '/contents', {
    categorySlug: 'outros', title, releaseYear: 2020, source: 'manual',
    destination: 'avaliado', rating: 7, reviewText: 'review secreta de A',
  });
  check('A cria uma obra avaliada', r.status === 201, `status ${r.status}`);
  if (r.status !== 201) throw new Error('Não foi possível preparar os dados de teste.');
  const contentId = r.json.content.id;
  const addedAt = r.json.content.addedAt;
  created.contentIds.push(contentId);

  r = await api(A.token, 'POST', '/contents', {
    categorySlug: 'outros', title: `${title} lista`, releaseYear: 2021, source: 'manual', destination: 'lista',
  });
  check('A cria uma obra na lista', r.status === 201, `status ${r.status}`);
  if (r.status !== 201) throw new Error('Não foi possível preparar os dados de teste.');
  const listContentId = r.json.content.id;
  created.contentIds.push(listContentId);

  // 3 ---------------------------------------------------------------------
  section('3. Conta B tentando mexer nos dados de A pela API');
  const expect404 = async (name, token, method, path, body) => {
    const res = await api(token, method, path, body);
    check(name, res.status === 404, `status ${res.status}`);
  };
  await expect404('B não abre o projeto de A', B.token, 'GET', `/projects/${projectId}`);
  await expect404('B não renomeia o projeto de A', B.token, 'PATCH', `/projects/${projectId}`, { name: 'HACK' });
  await expect404('B não apaga o projeto de A', B.token, 'DELETE', `/projects/${projectId}`);
  await expect404('B não lê os elementos do quadro de A', B.token, 'GET', `/projects/${projectId}/elements`);
  await expect404('B não grava elementos no quadro de A', B.token, 'POST', `/projects/${projectId}/elements/sync`,
    { upsert: [textElement(randomUUID(), 0, 'invasor')], remove: [] });
  await expect404('B não apaga elementos do quadro de A', B.token, 'POST', `/projects/${projectId}/elements/sync`,
    { upsert: [], remove: [e1] });
  await expect404('B não lê as conexões de A', B.token, 'GET', `/projects/${projectId}/connections`);
  await expect404('B não apaga conexões de A', B.token, 'POST', `/projects/${projectId}/connections/sync`,
    { upsert: [], remove: [connId] });
  await expect404('B não altera a obra de A', B.token, 'PATCH', `/contents/${contentId}`, { title: 'HACK' });
  await expect404('B não apaga a obra de A', B.token, 'DELETE', `/contents/${contentId}`);
  await expect404('B não avalia a obra de A', B.token, 'PUT', `/contents/${listContentId}/review`, { rating: 1 });
  await expect404('B não remove a avaliação de A', B.token, 'DELETE', `/contents/${contentId}/review`);

  r = await api(B.token, 'GET', '/projects');
  check('a lista de projetos de B não inclui o de A', r.status === 200 && !r.json.projects.some((p) => p.id === projectId));
  r = await api(B.token, 'GET', '/contents?category=all');
  check('o catálogo de B não inclui as obras de A',
    r.status === 200 && !r.json.contents.some((c) => c.id === contentId || c.id === listContentId));

  // 3b: os dados de A continuam intactos
  r = await api(A.token, 'GET', `/projects/${projectId}`);
  check('o projeto de A continua intacto', r.status === 200 && r.json.project.name === 'SEC-TEST projeto de A');
  r = await api(A.token, 'GET', `/projects/${projectId}/elements`);
  check('os elementos de A continuam intactos', r.status === 200 && r.json.elements.length === 2);
  r = await api(A.token, 'GET', `/projects/${projectId}/connections`);
  check('a conexão de A continua intacta', r.status === 200 && r.json.connections.length === 1);

  // 4 ---------------------------------------------------------------------
  section('4. Conta B atacando direto no banco (sem passar pelo backend)');
  const db = B.client;
  let q = await db.from('projects').select('id').eq('id', projectId);
  check('B não enxerga o projeto de A', noRows(q));
  q = await db.from('projects').update({ name: 'HACK' }).eq('id', projectId).select('id');
  check('B não altera o projeto de A', (q.data ?? []).length === 0);
  q = await db.from('projects').delete().eq('id', projectId).select('id');
  check('B não apaga o projeto de A', (q.data ?? []).length === 0);

  q = await db.from('board_elements').insert({ project_id: projectId, user_id: B.id, type: 'text', data: {} });
  check('B não insere elemento no quadro de A', Boolean(q.error));
  q = await db.from('board_elements').insert({ project_id: projectId, user_id: A.id, type: 'text', data: {} });
  check('B não insere elemento fingindo ser A', Boolean(q.error));

  const category = await db.from('categories').select('id').eq('slug', 'outros').is('user_id', null).single();
  q = await db.from('contents').insert({
    user_id: A.id, category_id: category.data?.id, title: 'HACK', source: 'manual',
  });
  check('B não cria obra em nome de A', Boolean(q.error));
  q = await db.from('reviews').insert({ content_id: listContentId, user_id: B.id, rating: 1 });
  check('B não avalia uma obra de A (mesmo com o próprio ID)', Boolean(q.error));
  q = await db.from('reviews').insert({ content_id: listContentId, user_id: A.id, rating: 1 });
  check('B não avalia uma obra de A (fingindo ser A)', Boolean(q.error));

  q = await db.from('profiles').select('id');
  check('B só enxerga o próprio perfil', !q.error && q.data.length === 1 && q.data[0].id === B.id);
  q = await db.from('profiles').update({ username: `hack_${Date.now()}` }).eq('id', A.id).select('id');
  check('B não altera o perfil de A', (q.data ?? []).length === 0);

  const strayPath = `${B.id}/${randomUUID()}.png`;
  q = await db.from('storage_files').insert({
    user_id: B.id, bucket: 'board-images', path: strayPath, project_id: projectId,
  });
  check('B não registra arquivo ligado ao projeto de A (exige hardening.sql)', Boolean(q.error));
  if (!q.error) await db.from('storage_files').delete().eq('path', strayPath);

  // 5 ---------------------------------------------------------------------
  section('5. Regras do banco para a conta A');
  q = await A.client.from('contents').update({ added_at: '2000-01-01T00:00:00Z' }).eq('id', contentId).select('added_at');
  check('a data de adição não pode ser alterada',
    Boolean(q.error) || (q.data?.[0] && Date.parse(q.data[0].added_at) === Date.parse(addedAt)));

  r = await api(A.token, 'PUT', `/contents/${contentId}/review`, { rating: 3, reviewText: 'editada' });
  check('editar a review mantém a data de adição',
    r.status === 200 && r.json.content.review.rating === 3 && Date.parse(r.json.content.addedAt) === Date.parse(addedAt),
    `status ${r.status}`);

  q = await A.client.from('contents').update({ user_id: B.id }).eq('id', contentId).select('user_id');
  check('o dono de uma obra não pode ser trocado',
    Boolean(q.error) || (q.data ?? []).length === 0 || q.data[0].user_id === A.id);

  r = await api(A.token, 'POST', '/contents', {
    categorySlug: 'outros', title, releaseYear: 2020, source: 'manual', destination: 'lista',
  });
  check('obra manual repetida é recusada (409)', r.status === 409, `status ${r.status}`);

  q = await A.client.from('board_elements').insert({
    project_id: projectId, user_id: A.id, type: 'text', data: { text: 'x'.repeat(140000) },
  });
  check('o banco recusa elemento gigante (exige hardening.sql)', Boolean(q.error));
  q = await A.client.from('projects').update({ viewport: 'texto' }).eq('id', projectId);
  check('o banco recusa viewport inválido (exige hardening.sql)', Boolean(q.error));

  // 6 ---------------------------------------------------------------------
  section('6. Validação das entradas da API (conta A)');
  const expect400 = async (name, method, path, body) => {
    const res = await api(A.token, method, path, body);
    check(name, res.status === 400, `status ${res.status}`);
  };
  await expect400('projeto sem nome', 'POST', '/projects', { name: '' });
  await expect400('projeto com nome gigante', 'POST', '/projects', { name: 'x'.repeat(121) });
  await expect400('zoom absurdo', 'PATCH', `/projects/${projectId}`, { viewport: { x: 0, y: 0, zoom: 99 } });
  await expect400('viewport com texto', 'PATCH', `/projects/${projectId}`, { viewport: { x: 'abc', y: 0, zoom: 1 } });
  await expect400('avaliar sem nota', 'POST', '/contents', { categorySlug: 'outros', title: 'X', destination: 'avaliado' });
  await expect400('nota 11', 'POST', '/contents', { categorySlug: 'outros', title: 'X', destination: 'avaliado', rating: 11 });
  await expect400('origem que não atende a categoria', 'POST', '/contents',
    { categorySlug: 'jogos', title: 'X', source: 'cinemeta', externalId: 'tt1234567' });
  await expect400('capa com endereço perigoso', 'POST', '/contents',
    { categorySlug: 'outros', title: 'X', coverUrl: 'javascript:alert(1)' });
  await expect400('categoria inexistente', 'GET', '/contents?category=xyz');
  await expect400('ID que não é UUID', 'GET', '/projects/nao-e-uuid');
  await expect400('busca com 1 caractere', 'GET', '/search?q=a');
  await expect400('elemento de tipo desconhecido', 'POST', `/projects/${projectId}/elements/sync`,
    { upsert: [{ ...textElement(randomUUID(), 0), type: 'script' }], remove: [] });
  await expect400('cor inválida em caixa de texto', 'POST', `/projects/${projectId}/elements/sync`,
    { upsert: [{ ...textElement(randomUUID(), 0), data: { ...textElement('x', 0).data, color: 'red' } }], remove: [] });
  await expect400('imagem com endereço perigoso', 'POST', `/projects/${projectId}/elements/sync`, {
    upsert: [{
      id: randomUUID(), type: 'image', x: 0, y: 0, width: 100, height: 100, zIndex: 0,
      data: { url: 'javascript:alert(1)', storagePath: `${A.id}/${randomUUID()}.png` },
    }],
    remove: [],
  });
  const foreignPath = `${B.id}/${randomUUID()}.png`;
  await expect400('imagem apontando para a pasta de outra pessoa', 'POST', `/projects/${projectId}/elements/sync`, {
    upsert: [{
      id: randomUUID(), type: 'image', x: 0, y: 0, width: 100, height: 100, zIndex: 0,
      data: { url: `https://x.supabase.co/storage/v1/object/public/board-images/${foreignPath}`, storagePath: foreignPath },
    }],
    remove: [],
  });

  // 7 ---------------------------------------------------------------------
  section('7. Armazenamento de imagens (Storage)');
  const ownPath = `${A.id}/${randomUUID()}.png`;
  const uploaded = await A.client.storage.from('board-images').upload(ownPath, PNG_BYTES, { contentType: 'image/png' });
  check('A envia imagem para a própria pasta', !uploaded.error, uploaded.error?.message);
  if (!uploaded.error) created.files.push(ownPath);
  const publicUrl = A.client.storage.from('board-images').getPublicUrl(ownPath).data.publicUrl;
  let fetched = await fetch(publicUrl);
  check('a imagem de A abre pelo endereço público', fetched.status === 200, `status ${fetched.status}`);

  const intruder = `${A.id}/${randomUUID()}.png`;
  const attack = await B.client.storage.from('board-images').upload(intruder, PNG_BYTES, { contentType: 'image/png' });
  check('B não envia arquivo para a pasta de A', Boolean(attack.error));
  if (!attack.error) created.files.push(intruder);

  const attackCover = `${A.id}/${randomUUID()}.png`;
  const coverAttack = await B.client.storage.from('covers').upload(attackCover, PNG_BYTES, { contentType: 'image/png' });
  check('B não envia capa para a pasta de A', Boolean(coverAttack.error));
  if (!coverAttack.error) await A.client.storage.from('covers').remove([attackCover]);

  await B.client.storage.from('board-images').remove([ownPath]);
  fetched = await fetch(publicUrl);
  check('B não apaga o arquivo de A', fetched.status === 200, `status ${fetched.status}`);

  const listing = await B.client.storage.from('board-images').list(A.id);
  check('B não lista os arquivos de A', Boolean(listing.error) || (listing.data ?? []).length === 0);

  const badType = `${B.id}/${randomUUID()}.png`;
  const bad = await B.client.storage.from('board-images').upload(badType, Buffer.from('nao sou imagem'), { contentType: 'text/plain' });
  check('o Storage recusa arquivo que não é imagem', Boolean(bad.error));
  if (!bad.error) await B.client.storage.from('board-images').remove([badType]);

  // 8 ---------------------------------------------------------------------
  section('8. Cabeçalhos de segurança e CORS');
  r = await api(null, 'GET', '/health');
  check('cabeçalho X-Content-Type-Options: nosniff', r.headers.get('x-content-type-options') === 'nosniff');
  check('não revela que usa Express (X-Powered-By)', !r.headers.get('x-powered-by'));
  check('respostas da API não ficam em cache', (r.headers.get('cache-control') ?? '').includes('no-store'));

  const evil = await rawGet('/health', 'https://site-malicioso.example');
  check('origem desconhecida é recusada (403)', evil.status === 403, `status ${evil.status}`);
  const allowedOrigin = env.FRONTEND_URL.split(',')[0].trim();
  const good = await rawGet('/health', allowedOrigin);
  check('origem do frontend é aceita', good.status === 200 && good.headers['access-control-allow-origin'] === allowedOrigin,
    `status ${good.status}`);
}

async function cleanup(A, created) {
  console.log('\nLimpando os dados de teste…');
  for (const id of created.contentIds) await api(A.token, 'DELETE', `/contents/${id}`).catch(() => {});
  if (created.projectId) await api(A.token, 'DELETE', `/projects/${created.projectId}`).catch(() => {});
  if (created.files.length > 0) await A.client.storage.from('board-images').remove(created.files).catch(() => {});
}

async function main() {
  const missing = ['TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD'].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Faltam variáveis de ambiente: ${missing.join(', ')}\nVeja as instruções da Etapa 9.`);
    process.exit(2);
  }

  const health = await api(null, 'GET', '/health').catch(() => null);
  if (!health || health.status !== 200) {
    console.error('O backend não respondeu. Rode "npm run dev" em outro terminal e tente de novo.');
    process.exit(2);
  }

  const A = await signIn(process.env.TEST_A_EMAIL, process.env.TEST_A_PASSWORD);
  const B = await signIn(process.env.TEST_B_EMAIL, process.env.TEST_B_PASSWORD);
  if (A.id === B.id) throw new Error('As duas contas de teste precisam ser DIFERENTES.');

  const created = { projectId: null, contentIds: [], files: [] };
  try {
    await runChecks(A, B, created);
  } finally {
    await cleanup(A, created);
  }

  console.log(`\nResultado: ${stats.passed} passaram, ${stats.failed} falharam.`);
  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nO teste foi interrompido:', error.message);
  process.exit(2);
});