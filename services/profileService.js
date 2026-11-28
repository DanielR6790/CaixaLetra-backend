// Regras do perfil: nome de usuário, fuso horário e foto.
// Usa a conexão "como o usuário" (req.supabase): o RLS garante que cada um só altera o próprio perfil.
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { assertNoError } from '../utils/db.js';

const COLUMNS = 'id, username, avatar_url, timezone, created_at';
const AVATAR_MARKER = '/storage/v1/object/public/avatars/';
const AVATAR_FILE = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i;

// A foto precisa estar na pasta do próprio usuário, no bucket "avatars" do nosso Supabase
function assertOwnAvatarUrl(url, userId) {
  const base = `${new URL(env.SUPABASE_URL).origin}${AVATAR_MARKER}${userId}/`;
  if (!url.startsWith(base) || !AVATAR_FILE.test(url.slice(base.length))) {
    throw new AppError('Endereço da foto inválido.', 400, 'VALIDATION_ERROR');
  }
}

// Apaga do Storage a foto antiga (melhor esforço: se falhar, só registra no terminal)
async function removeAvatarFile(supabase, url) {
  if (!url) return;
  const index = url.indexOf(AVATAR_MARKER);
  if (index === -1) return;

  const path = decodeURIComponent(url.slice(index + AVATAR_MARKER.length).split('?')[0]);
  try {
    const { error } = await supabase.storage.from('avatars').remove([path]);
    if (error) console.warn('[Storage] Não foi possível apagar a foto antiga:', error.message);
  } catch (error) {
    console.warn('[Storage] Não foi possível apagar a foto antiga:', error?.message);
  }
}

export async function updateProfile(supabase, userId, patch) {
  const row = {};
  if (patch.username !== undefined) row.username = patch.username;
  if (patch.timezone !== undefined) row.timezone = patch.timezone;
  if (patch.avatarUrl !== undefined) {
    if (patch.avatarUrl !== null) assertOwnAvatarUrl(patch.avatarUrl, userId);
    row.avatar_url = patch.avatarUrl;
  }

  // Guarda a foto atual para apagá-la do Storage depois da troca
  let previousAvatar = null;
  if (patch.avatarUrl !== undefined) {
    const { data, error } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .maybeSingle();
    assertNoError(error, 'Não foi possível carregar o perfil.');
    previousAvatar = data?.avatar_url ?? null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(row)
    .eq('id', userId)
    .select(COLUMNS)
    .maybeSingle();

  if (error?.code === '23505') {
    throw new AppError('Este nome de usuário já está em uso. Escolha outro.', 409, 'USERNAME_TAKEN');
  }
  if (error?.code === '23514') {
    console.error('[DB]', error.code, error.message);
    throw new AppError('Nome de usuário ou fuso horário não aceito.', 400, 'VALIDATION_ERROR');
  }
  assertNoError(error, 'Não foi possível salvar o perfil.');
  if (!data) throw new AppError('Perfil não encontrado.', 404, 'NOT_FOUND');

  if (patch.avatarUrl !== undefined && previousAvatar && previousAvatar !== data.avatar_url) {
    await removeAvatarFile(supabase, previousAvatar);
  }

  return data;
}