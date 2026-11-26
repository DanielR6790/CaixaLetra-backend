// Cria conexões com o Supabase.
// Usamos SOMENTE a chave pública "anon". As permissões vêm do token do
// usuário logado, então o RLS do banco continua protegendo tudo.
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

const baseOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

// Conexão sem usuário (usada apenas para validar tokens)
export function createAnonClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, baseOptions);
}

// Conexão "como o usuário": as consultas respeitam o RLS
export function createUserClient(accessToken) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...baseOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}