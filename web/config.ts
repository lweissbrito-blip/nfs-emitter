/**
 * Empresa, clientes e certificado no app web. Mesma validação da linha de
 * comando (src/validacao.ts); os dados vêm do banco e o certificado das
 * variáveis de ambiente CERT_PFX_BASE64 + CERT_SENHA.
 */
import { parsePfx } from 'open-nfse';
import {
  ErroConfig,
  validarCliente,
  validarEmpresa,
  type Cliente,
  type Empresa,
} from '../src/validacao';
import { sql } from './db';

export type Bruto = Record<string, unknown>;

export async function lerEmpresaBruta(): Promise<Bruto | undefined> {
  const [r] = await sql<{ valor: Bruto }>(`select valor from configuracao where chave = 'empresa'`);
  return r?.valor;
}

export async function carregarEmpresa(): Promise<Empresa> {
  const j = await lerEmpresaBruta();
  if (!j) throw new ErroConfig('Empresa', ['ainda não preenchida — abra Configuração']);
  return validarEmpresa(j, 'Empresa');
}

/** Valida e salva. Lança ErroConfig com todos os problemas se algo estiver errado. */
export async function salvarEmpresa(j: Bruto): Promise<Empresa> {
  const empresa = validarEmpresa(j, 'Empresa');
  await sql(
    `insert into configuracao (chave, valor) values ('empresa', $1)
     on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
    [JSON.stringify(j)],
  );
  return empresa;
}

export async function listarClientesBrutos(): Promise<{ apelido: string; dados: Bruto }[]> {
  return sql(`select apelido, dados from clientes order by apelido`);
}

export async function lerClienteBruto(apelido: string): Promise<Bruto | undefined> {
  const [r] = await sql<{ dados: Bruto }>(`select dados from clientes where apelido = $1`, [apelido]);
  return r?.dados;
}

export async function carregarCliente(apelido: string, empresa: Empresa): Promise<Cliente> {
  const j = await lerClienteBruto(apelido);
  if (!j) throw new ErroConfig(`Cliente "${apelido}"`, ['não encontrado']);
  return validarCliente(apelido, j, empresa, `Cliente "${apelido}"`);
}

export async function salvarCliente(apelido: string, j: Bruto, empresa: Empresa): Promise<Cliente> {
  const cliente = validarCliente(apelido, j, empresa, `Cliente "${apelido}"`);
  await sql(
    `insert into clientes (apelido, dados) values ($1, $2)
     on conflict (apelido) do update set dados = excluded.dados, atualizado_em = now()`,
    [apelido, JSON.stringify(j)],
  );
  return cliente;
}

export async function excluirCliente(apelido: string) {
  await sql(`delete from clientes where apelido = $1`, [apelido]);
}

export interface CertificadoCarregado {
  pfx: Buffer;
  senha: string;
  titular: string;
  cnpjCert?: string;
  validade: Date;
  dias: number;
}

export function carregarCertificado(empresa?: Empresa): CertificadoCarregado {
  const prob: string[] = [];
  const b64 = (process.env.CERT_PFX_BASE64 ?? '').replace(/\s/g, '');
  const senha = process.env.CERT_SENHA ?? '';
  if (!b64) prob.push('CERT_PFX_BASE64: o arquivo .pfx convertido para base64');
  if (!senha) prob.push('CERT_SENHA: senha do certificado');
  if (prob.length) throw new ErroConfig('Variáveis de ambiente', prob);

  const pfx = Buffer.from(b64, 'base64');
  const cert = parsePfx(pfx, senha); // lança se senha errada / vencido / corrompido
  const cnpjCert = cert.subject.match(/\d{14}/)?.[0];
  if (empresa && cnpjCert && cnpjCert !== empresa.cnpj) {
    throw new Error(
      `O certificado é do CNPJ ${cnpjCert}, mas a empresa configurada é ${empresa.cnpj}. ` +
        'A Receita exige o certificado do próprio CNPJ emissor.',
    );
  }
  return {
    pfx,
    senha,
    titular: cert.subject.split(',')[0],
    cnpjCert,
    validade: cert.expiresOn,
    dias: Math.floor((cert.expiresOn.getTime() - Date.now()) / 86_400_000),
  };
}
