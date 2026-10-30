import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Espelha o mapeamento do Sidebar — path → chave de modulos_visiveis
const PATH_TO_MODULE: Record<string, string> = {
  '/cadastro':   'cadastro_basico',
  '/matriculas': 'matriculas',
  '/academico':  'academico',
  '/financeiro': 'financeiro',
  '/doacoes':    'doacoes',
  '/estoque':    'estoque',
  '/relatorios': 'relatorios',
  '/gente': 'gente',
};

// Cargos que bypassam verificação de módulo e têm acesso total ao sistema
const ROLES_FULL_ACCESS = ['admin', 'prt'];

// Cargos mínimos para acessar /config (gestão de acesso)
const ROLES_CONFIG = ['admin', 'prt', 'vp', 'drt'];

/**
 * Decodifica o payload de um JWT (base64url) sem verificar assinatura.
 * A verificação real ocorre no backend a cada chamada de API.
 */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const clean = token.replace(/"/g, '');
    const base64 = clean.split('.')[1];
    if (!base64) return null;
    const decoded = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Verifica se o token JWT é estruturalmente válido e não está expirado.
 * Não verifica assinatura — isso é responsabilidade do backend.
 */
function isTokenValid(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    if (!payload) return false;
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get('itp_token')?.value;
  const hasValidToken = !!token && isTokenValid(token);
  const { pathname } = request.nextUrl;

  // ── Redirecionamento da Raiz ──────────────────────────────────────────────
  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = hasValidToken ? '/dashboard' : '/login';
    return NextResponse.redirect(url);
  }

  // ── Rotas sempre públicas ─────────────────────────────────────────────────
  if (pathname.startsWith('/ponto'))               return NextResponse.next();
  if (pathname.startsWith('/chamada-professor'))   return NextResponse.next();
  if (pathname.startsWith('/estoque/coletor'))     return NextResponse.next();
  if (pathname.startsWith('/esqueci-senha'))   return NextResponse.next();
  if (pathname.startsWith('/reset-senha'))     return NextResponse.next();
  if (pathname.startsWith('/lgpd'))            return NextResponse.next();
  if (pathname.startsWith('/inscricao'))      return NextResponse.next();
  // Página de troca obrigatória de senha (requer cookie, mas não bloqueia redirect)
  if (pathname.startsWith('/trocar-senha'))    return NextResponse.next();

  // ── Proteção: exige autenticação ──────────────────────────────────────────
  const privateRoutes = [
    '/dashboard', '/matriculas', '/academico', '/financeiro',
    '/cadastro',  '/config',     '/doacoes',   '/estoque', '/relatorios',
    '/notificacoes', '/chamada', '/gente',
  ];
  const isPrivateRoute = privateRoutes.some(r => pathname.startsWith(r));

  if (isPrivateRoute && !hasValidToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Proteção: permissões de módulo por grupo ──────────────────────────────
  if (isPrivateRoute && hasValidToken) {
    const payload = decodeJwtPayload(token!);
    const role    = (payload?.role ?? '').toLowerCase().trim();

    // Dashboard é sempre acessível para usuários autenticados
    if (!pathname.startsWith('/dashboard') && !pathname.startsWith('/notificacoes')) {

      // /config: restrito a DRT ou superior
      if (pathname.startsWith('/config')) {
        if (!ROLES_CONFIG.includes(role)) {
          return NextResponse.redirect(new URL('/dashboard', request.url));
        }
      } else if (!ROLES_FULL_ACCESS.includes(role)) {
        // Verifica modulos_visiveis do grupo para as demais rotas.
        // Espelha a lógica do Sidebar: grupo sem config = acesso liberado;
        // bloqueia apenas quando o módulo está EXPLICITAMENTE definido como false.
        const segment = `/${pathname.split('/').filter(Boolean)[0] ?? ''}`;
        const moduloKey = PATH_TO_MODULE[segment];
        if (moduloKey) {
          const modulosVisiveis = payload?.permissoes?.modulos_visiveis as Record<string, boolean> | undefined;
          if (modulosVisiveis && modulosVisiveis[moduloKey] === false) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
          }
        }
      }
    }
  }

  // ── Impedir acesso ao Login se já autenticado ─────────────────────────────
  if (pathname.startsWith('/login') && hasValidToken) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Matcher focado em rotas de páginas.
     * Exclui: rotas de API internas (api/), proxy do backend (backend-api/),
     * uploads, arquivos estáticos do Next.js e assets.
     */
    '/((?!api|backend-api|uploads|_next/static|_next/image|assets|favicon.ico|sw.js).*)',
  ],
};