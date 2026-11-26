import { asyncHandler } from '../utils/asyncHandler.js';
import { assertNoError } from '../utils/db.js';

// Dados do usuário logado
export const getMe = asyncHandler(async (req, res) => {
  console.log('[userController] getMe chamado');

  const { data, error } = await req.supabase
    .from('profiles')
    .select('id, username, avatar_url, timezone, created_at')
    .eq('id', req.user.id)
    .single();

  assertNoError(error, 'Não foi possível carregar o perfil.');
  res.json({ profile: data, email: req.user.email });
});

// Categorias do sistema + personalizadas do usuário
export const getCategories = asyncHandler(async (req, res) => {
  console.log('[userController] getCategories chamado');

  const { data, error } = await req.supabase
    .from('categories')
    .select('id, slug, name, is_system, sort_order')
    .order('sort_order', { ascending: true });

  assertNoError(error, 'Não foi possível carregar as categorias.');
  res.json({ categories: data });
});