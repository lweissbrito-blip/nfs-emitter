'use server';
/**
 * Server actions. São endpoints POST públicos: TODAS começam com exigirLogin().
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Cotacao } from '../src/cotacao';
import { ErroConfig, validarApelido } from '../src/validacao';
import { entrar, exigirLogin, sair } from '../web/auth';
import { CAMPOS_CLIENTE, CAMPOS_EMPRESA, lerFormulario } from '../web/campos';
import { carregarEmpresa, excluirCliente, salvarCliente, salvarEmpresa } from '../web/config';
import {
  cancelar,
  emitir,
  importarPorChave,
  mensagemErro,
  previa,
  verificar,
  verificarPendente,
  type ItemVerificacao,
  type Pedido,
  type Previa,
  type Resultado,
} from '../web/emissao';

export type Estado = { ok?: string; erro?: string; detalhes?: string[] } | null;

function falha(e: unknown): Estado {
  if (e instanceof ErroConfig) return { erro: `Problemas em ${e.arquivo}:`, detalhes: e.problemas };
  const m = mensagemErro(e);
  return { erro: m.mensagem, ...(m.detalhes ? { detalhes: m.detalhes } : {}) };
}

export async function acaoEntrar(_: Estado, form: FormData): Promise<Estado> {
  if (await entrar(String(form.get('senha') ?? ''))) redirect('/');
  return { erro: 'Senha incorreta.' };
}

export async function acaoSair() {
  await sair();
  redirect('/login');
}

export async function acaoSalvarEmpresa(_: Estado, form: FormData): Promise<Estado> {
  await exigirLogin();
  try {
    await salvarEmpresa(lerFormulario(form, CAMPOS_EMPRESA));
  } catch (e) {
    return falha(e);
  }
  revalidatePath('/', 'layout');
  return { ok: 'Dados da empresa salvos.' };
}

export async function acaoSalvarCliente(_: Estado, form: FormData): Promise<Estado> {
  await exigirLogin();
  const apelido = String(form.get('apelido') ?? '').trim().toLowerCase();
  try {
    validarApelido(apelido);
    const empresa = await carregarEmpresa().catch(() => {
      throw new Error('Preencha e salve os dados da empresa antes de cadastrar clientes.');
    });
    await salvarCliente(apelido, lerFormulario(form, CAMPOS_CLIENTE), empresa);
  } catch (e) {
    return falha(e);
  }
  revalidatePath('/', 'layout');
  redirect('/configuracao');
}

export async function acaoExcluirCliente(form: FormData) {
  await exigirLogin();
  await excluirCliente(String(form.get('apelido')));
  revalidatePath('/', 'layout');
  redirect('/configuracao');
}

export async function acaoVerificar(testarReceita: false | { producao: boolean }): Promise<ItemVerificacao[]> {
  await exigirLogin();
  return verificar(testarReceita);
}

function lerNumero(bruto: FormDataEntryValue | null): number | undefined {
  const s = String(bruto ?? '').trim();
  if (!s) return undefined;
  // aceita 2500, 2500.50, 2.500,50
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}

export type EstadoPrevia = { previa?: Previa; erro?: string; detalhes?: string[] } | null;

export async function acaoPrevia(_: EstadoPrevia, form: FormData): Promise<EstadoPrevia> {
  await exigirLogin();
  try {
    const pedido: Pedido = {
      apelido: String(form.get('apelido') ?? ''),
      producao: form.get('ambiente') === 'producao',
      valorMoeda: lerNumero(form.get('valor')) ?? 0,
      competencia: String(form.get('competencia') ?? ''),
      descricao: String(form.get('descricao') ?? '').trim() || undefined,
      cotacaoManual: lerNumero(form.get('cotacao')),
    };
    return { previa: await previa(pedido) };
  } catch (e) {
    const f = falha(e)!;
    return { erro: f.erro, detalhes: f.detalhes };
  }
}

export async function acaoEmitir(pedido: Pedido, cotacao: Cotacao, confirmacao: string): Promise<Resultado> {
  await exigirLogin();
  if (pedido.producao && confirmacao !== 'EMITIR') {
    return { tipo: 'erro', mensagem: 'Digite EMITIR para confirmar a nota real.' };
  }
  const r = await emitir(pedido, cotacao);
  revalidatePath('/notas');
  return r;
}

export async function acaoVerificarPendente(producao: boolean): Promise<Resultado> {
  await exigirLogin();
  const r = await verificarPendente(producao);
  revalidatePath('/notas');
  return r;
}

export async function acaoImportar(_: Estado, form: FormData): Promise<Estado> {
  await exigirLogin();
  const r = await importarPorChave(String(form.get('chave') ?? ''), form.get('ambiente') === 'producao');
  revalidatePath('/notas');
  if (r.tipo === 'erro') return { erro: r.mensagem, detalhes: r.detalhes };
  if (r.tipo === 'pendente-resolvida') return { ok: `Nota nº ${r.nota.numero} (${r.nota.tomador}) salva.` };
  return null;
}

export async function acaoCancelar(_: Estado, form: FormData): Promise<Estado> {
  await exigirLogin();
  if (form.get('confirmacao') !== 'CANCELAR') return { erro: 'Digite CANCELAR para confirmar.' };
  const r = await cancelar(Number(form.get('id')), String(form.get('motivo') ?? ''), form.get('naoPrestado') === 'on');
  revalidatePath('/notas');
  return r.ok ? { ok: 'Nota cancelada. O comprovante está na lista.' } : { erro: r.mensagem, detalhes: r.detalhes };
}
