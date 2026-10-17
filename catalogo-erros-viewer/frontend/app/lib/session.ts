// Sessão do ITP_TEC — cookie assinado (HMAC-SHA256 via Web Crypto API,
// nao o modulo `crypto` do Node - o middleware.ts roda em Edge Runtime,
// que so tem WebCrypto). Guarda so o essencial: email, nome, role
// (admin|tec) e expiracao.

const SESSION_COOKIE = "itp_tec_session";
const DURACAO_MS = 8 * 60 * 60 * 1000; // 8h

export type Sessao = {
  email: string;
  nome: string;
  role: "admin" | "tec";
  exp: number;
};

function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let bin = "";
  arr.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function chaveHmac(): Promise<CryptoKey> {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("SESSION_SECRET nao configurado");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function assinar(payload: string): Promise<string> {
  const chave = await chaveHmac();
  const assinatura = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(payload));
  return base64UrlEncode(assinatura);
}

export async function criarCookieSessao(dados: Omit<Sessao, "exp">): Promise<string> {
  const sessao: Sessao = { ...dados, exp: Date.now() + DURACAO_MS };
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(sessao)));
  const assinatura = await assinar(payload);
  return `${payload}.${assinatura}`;
}

export async function validarCookieSessao(valor: string | undefined): Promise<Sessao | null> {
  if (!valor) return null;
  const [payload, assinatura] = valor.split(".");
  if (!payload || !assinatura) return null;

  const chave = await chaveHmac();
  let assinaturaValida: boolean;
  try {
    assinaturaValida = await crypto.subtle.verify(
      "HMAC", chave, base64UrlDecode(assinatura), new TextEncoder().encode(payload)
    );
  } catch {
    return null;
  }
  if (!assinaturaValida) return null;

  try {
    const sessao: Sessao = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    if (sessao.exp < Date.now()) return null;
    return sessao;
  } catch {
    return null;
  }
}

// Role vem do grupo do Entra ID "ITP_AM_TECNOLOGIA" (o manual, nao o
// duplicado auto-criado pelo Teams "ITP & AM - Tecnologia" - decisao ja
// registrada no plano de migracao). App-only (client credentials) porque
// o app "ERP ITP - Login SSO" ja tem Group.Read.All consentido - nao
// precisa de escopo delegado extra no login do usuario.
const GRUPO_TECNOLOGIA_ID = "5dd2017f-2bd6-4b74-89b2-37ab3f64643a";

export async function determinarRole(userOid: string): Promise<"admin" | "tec"> {
  try {
    const tenantId = process.env.MS_TENANT_ID!;
    const tokenResp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID!,
        client_secret: process.env.MS_CLIENT_SECRET!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    if (!tokenResp.ok) return "tec";
    const { access_token } = await tokenResp.json();

    const memberOfResp = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userOid}/memberOf?$select=id`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (!memberOfResp.ok) return "tec";
    const { value } = await memberOfResp.json();
    const membro = (value as { id: string }[]).some((g) => g.id === GRUPO_TECNOLOGIA_ID);
    return membro ? "admin" : "tec";
  } catch {
    return "tec"; // falha ao checar grupo = menor privilegio, nunca falha aberto
  }
}

export { SESSION_COOKIE };
