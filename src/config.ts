import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  ErroConfig,
  validarApelido,
  validarCliente,
  validarEmpresa,
  type Cliente,
  type Empresa,
} from './validacao';

export * from './validacao';

export const RAIZ = path.resolve(import.meta.dirname, '..');

export interface Certificado {
  arquivo: string;
  senha: string;
}

function lerJson(arquivo: string): Record<string, unknown> {
  if (!existsSync(arquivo)) {
    throw new ErroConfig(path.relative(RAIZ, arquivo), [
      'arquivo não encontrado — copie o .exemplo.json correspondente e preencha',
    ]);
  }
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8'));
  } catch (e) {
    throw new ErroConfig(path.relative(RAIZ, arquivo), [
      `JSON inválido: ${(e as Error).message}`,
    ]);
  }
}

export function carregarEmpresa(): Empresa {
  return validarEmpresa(lerJson(path.join(RAIZ, 'config', 'empresa.json')));
}

export function listarClientes(): string[] {
  const dir = path.join(RAIZ, 'config', 'clientes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.exemplo.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function carregarCliente(apelido: string, empresa: Empresa): Cliente {
  validarApelido(apelido);
  const rel = `config/clientes/${apelido}.json`;
  const arquivo = path.join(RAIZ, rel);
  if (!existsSync(arquivo)) {
    const existentes = listarClientes();
    throw new ErroConfig(rel, [
      'cliente não encontrado',
      existentes.length
        ? `clientes disponíveis: ${existentes.join(', ')}`
        : 'nenhum cliente configurado ainda — copie config/clientes/cliente.exemplo.json',
    ]);
  }
  return validarCliente(apelido, lerJson(arquivo), empresa, rel);
}

export function carregarCertificado(): Certificado {
  const envPath = path.join(RAIZ, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  const prob: string[] = [];
  const arquivoCfg = process.env.CERT_ARQUIVO?.trim();
  const senha = process.env.CERT_SENHA ?? '';
  if (!arquivoCfg) prob.push('CERT_ARQUIVO: caminho do certificado .pfx');
  if (!senha) prob.push('CERT_SENHA: senha do certificado');
  const arquivo = arquivoCfg ? path.resolve(RAIZ, arquivoCfg) : '';
  if (arquivo && !existsSync(arquivo)) prob.push(`certificado não encontrado em ${arquivo}`);
  if (prob.length) throw new ErroConfig('.env', prob);
  return { arquivo, senha };
}
