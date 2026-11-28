import { asyncHandler } from '../utils/asyncHandler.js';
import { assertNoError } from '../utils/db.js';
import { updateProfile } from '../services/profileService.js';

// Dados do usuário logado
export const getMe = asyncHandler(async (req, res) => {
  const { data, error } = await req.supabase
    .from('profiles')
    .select('id, username, avatar_url, timezone, created_at')
    .eq('id', req.user.id)
    .single();

  assertNoError(error, 'Não foi possível carregar o perfil.');
  res.json({ profile: data, email: req.user.email });
});

// Altera nome de usuário, fuso horário e/ou foto
export const updateMe = asyncHandler(async (req, res) => {
  const profile = await updateProfile(req.supabase, req.user.id, req.body);
  res.json({ profile, email: req.user.email });
});

// Categorias do sistema + personalizadas do usuário
export const getCategories = asyncHandler(async (req, res) => {
  const { data, error } = await req.supabase
    .from('categories')
    .select('id, slug, name, is_system, sort_order')
    .order('sort_order', { ascending: true });

  assertNoError(error, 'Não foi possível carregar as categorias.');
  res.json({ categories: data });
});