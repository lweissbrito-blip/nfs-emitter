/**
 * Login de um usuário só: senha em APP_SENHA, sessão num cookie assinado com
 * HMAC (chave derivada de APP_SEGREDO + APP_SENHA — trocar a senha derruba as
 * sessões). Sem as duas variáveis, ninguém entra.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const COOKIE = 'sessao';
const DURACAO_S = 12 * 60 * 60;

export function problemaAuth(): string | undefined {
  const senha = process.env.APP_SENHA ?? '';
  if (!process.env.APP_SEGREDO || process.env.APP_SEGREDO.length < 32) {
    return 'APP_SEGREDO não configurado (mínimo de 32 caracteres).';
  }
  if (senha.length < 12) return 'APP_SENHA não configurada (mínimo de 12 caracteres).';
  return undefined;
}

function chave(): Buffer {
  return createHmac('sha256', process.env.APP_SEGREDO!).update(process.env.APP_SENHA!).digest();
}

const assinar = (dados: string) => createHmac('sha256', chave()).update(dados).digest('base64url');

function iguais(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function sessaoValida(): Promise<boolean> {
  if (problemaAuth()) return false;
  const valor = (await cookies()).get(COOKIE)?.value;
  if (!valor) return false;
  const [exp, assinatura] = valor.split('.');
  if (!exp || !assinatura || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return iguais(assinatura, assinar(exp));
}

/** Use no começo de toda página, server action e rota. */
export async function exigirLogin() {
  if (!(await sessaoValida())) redirect('/login');
}

export async function entrar(senha: string): Promise<boolean> {
  if (problemaAuth()) return false;
  if (!iguais(senha, process.env.APP_SENHA!)) {
    await new Promise((r) => setTimeout(r, 1500)); // atrasa tentativas por força bruta
    return false;
  }
  const exp = String(Math.floor(Date.now() / 1000) + DURACAO_S);
  (await cookies()).set(COOKIE, `${exp}.${assinar(exp)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DURACAO_S,
  });
  return true;
}

export async function sair() {
  (await cookies()).delete(COOKIE);
}
