/**
 * Fluxo de emissão do app web — mesmas regras de cmdNota/resolverPendente em
 * src/cli.ts, com o estado no banco (web/armazem.ts).
 *
 * Invariante: nunca enviar uma DPS nova enquanto uma anterior estiver sem
 * resposta. O pendente é gravado ANTES do envio e só é limpo quando se sabe
 * que a Receita não processou (rejeição, validação, auth) ou depois de salvar
 * a nota autorizada.
 */
import {
  Ambiente,
  createInMemoryRetryStore,
  ForbiddenError,
  gerarDanfse,
  InvalidCertificateError,
  JustificativaCancelamento,
  NfseClient,
  NotFoundError,
  parseNfseXml,
  ReceitaRejectionError,
  TipoAmbienteDps,
  UnauthorizedError,
  ValidationError,
  type NFSe,
} from 'open-nfse';
import type { NfseClientLike } from 'open-nfse/testing';
import { buscarPtax, hojeBrasilia, type Cotacao } from '../src/cotacao';
import { montarDps, preencherDescricao } from '../src/dps';
import { DICAS, explicarErro, observacoesDanfse } from '../src/nucleo';
import * as arm from './armazem';
import { carregarCertificado, carregarCliente, carregarEmpresa, listarClientesBrutos } from './config';

type Api = NfseClientLike;

let fabricaApi = (producao: boolean, pfx: Buffer, senha: string): Api =>
  new NfseClient({
    ambiente: producao ? Ambiente.Producao : Ambiente.ProducaoRestrita,
    certificado: { pfx, password: senha },
    timeoutMs: 60_000,
  });

/** Usado só pelos testes automatizados, para trocar a API real por uma simulada. */
export function usarFabricaApi(f: typeof fabricaApi) {
  fabricaApi = f;
}

/**
 * Um pendente mais novo que isso pode ser uma requisição ainda em andamento
 * (a função tem maxDuration de 120 s): não consulta nem libera, só espera.
 */
const PENDENTE_EM_ANDAMENTO_MS = 3 * 60_000;

export interface Pedido {
  apelido: string;
  producao: boolean;
  valorMoeda: number;
  competencia: string; // AAAA-MM-DD
  descricao?: string;
  /** Cotação manual; se ausente, busca a PTAX. */
  cotacaoManual?: number;
}

export interface Previa {
  pedido: Pedido;
  cotacao: Cotacao;
  clienteNome: string;
  moeda: string;
  paisResultado: string;
  descricao: string;
  valorReais: number;
  serie: string;
  nDPS: string;
  pendente: arm.Pendente | null;
}

export interface NotaResumo {
  id?: number;
  numero: string;
  chave: string;
  tomador: string;
  valorReais: number;
  producao: boolean;
}

export type Resultado =
  | { tipo: 'emitida'; nota: NotaResumo; alertas: string[] }
  | { tipo: 'pendente-resolvida'; nota: NotaResumo }
  | { tipo: 'incerto'; mensagem: string }
  | { tipo: 'info'; mensagem: string }
  | { tipo: 'erro'; mensagem: string; detalhes?: string[] };

export function mensagemErro(e: unknown): { mensagem: string; detalhes?: string[] } {
  if (e instanceof ReceitaRejectionError) {
    return {
      mensagem: 'A Receita rejeitou a nota. Nenhuma nota foi gerada.',
      detalhes: e.mensagens.map(
        (m) =>
          `[${m.codigo}] ${m.descricao}${m.complemento ? ` — ${m.complemento}` : ''}` +
          (DICAS[m.codigo] ? ` → ${DICAS[m.codigo]}` : ''),
      ),
    };
  }
  const msg = explicarErro(e);
  const [primeira, ...resto] = msg.split('\n');
  return { mensagem: primeira, ...(resto.length ? { detalhes: resto.map((l) => l.replace(/^\s*•\s*/, '')) } : {}) };
}

async function prepararCotacao(p: Pedido, moeda: string, tipo: 'venda' | 'compra'): Promise<Cotacao> {
  if (p.cotacaoManual !== undefined) {
    return { moeda, tipo, valor: p.cotacaoManual, data: hojeBrasilia(), fonte: 'cotação informada manualmente' };
  }
  return buscarPtax(moeda, tipo, hojeBrasilia());
}

function validarPedido(p: Pedido) {
  if (!(p.valorMoeda > 0)) throw new Error('Informe o valor da invoice.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.competencia)) throw new Error('Competência inválida.');
  if (p.competencia > hojeBrasilia()) throw new Error('A competência não pode ser uma data futura.');
  if (p.cotacaoManual !== undefined && !(p.cotacaoManual > 0)) throw new Error('Cotação inválida.');
}

/** Monta, valida no XSD oficial e assina, sem enviar. */
export async function previa(p: Pedido): Promise<Previa> {
  validarPedido(p);
  const empresa = await carregarEmpresa();
  const cliente = await carregarCliente(p.apelido, empresa);
  const cert = carregarCertificado(empresa);
  if (cert.dias < 0) throw new Error('O certificado está vencido.');

  const amb = arm.nomeAmb(p.producao);
  const cotacao = await prepararCotacao(p, cliente.moeda, empresa.cotacao.tipo);
  const descricao = preencherDescricao(p.descricao?.trim() || cliente.descricao, p.competencia);
  if (descricao.length > 2000) throw new Error('A descrição passou de 2000 caracteres.');
  const nDPS = await arm.proximoNumero(amb, empresa.serie);
  const nota = montarDps({
    empresa, cliente, nDPS, producao: p.producao, valorMoeda: p.valorMoeda, cotacao,
    competencia: p.competencia, descricao,
  });

  const api = fabricaApi(p.producao, cert.pfx, cert.senha);
  try {
    await api.emitirDpsPronta(nota.dps, { dryRun: true, skipCepValidation: true });
  } finally {
    await api.close();
  }
  return {
    pedido: { ...p, descricao },
    cotacao,
    clienteNome: cliente.nome,
    moeda: cliente.moeda,
    paisResultado: cliente.paisResultado,
    descricao,
    valorReais: nota.valorReais,
    serie: empresa.serie,
    nDPS,
    pendente: await arm.pendente(amb),
  };
}

async function guardarNota(
  producao: boolean,
  xmlNfse: string,
  nfse: NFSe,
  extra: { cliente: string | null; valorMoeda: number | null; moeda: string | null; cotacao: number | null },
): Promise<NotaResumo> {
  const inf = nfse.infNFSe;
  const dps = inf.DPS.infDPS;
  await arm.registrarNota({
    ambiente: arm.nomeAmb(producao),
    chave: inf.chaveAcesso,
    numeroNfse: inf.nNFSe,
    nDPS: dps.nDPS,
    serie: dps.serie,
    tomador: dps.toma?.xNome ?? null,
    competencia: dps.dCompet.toISOString().slice(0, 10),
    valorReais: dps.valores.vServPrest.vServ,
    xml: xmlNfse,
    ...extra,
  });
  return {
    numero: inf.nNFSe,
    chave: inf.chaveAcesso,
    tomador: dps.toma?.xNome ?? '—',
    valorReais: dps.valores.vServPrest.vServ,
    producao,
  };
}

/**
 * Se houver emissão sem confirmação, pergunta à Receita. 'emitida' = a nota
 * existia (já salva); 'livre' = pode seguir. Qualquer dúvida lança erro.
 */
async function resolverPendente(api: Api, producao: boolean): Promise<'livre' | NotaResumo> {
  const amb = arm.nomeAmb(producao);
  const p = await arm.pendente(amb);
  if (!p) return 'livre';
  if (Date.now() - new Date(p.criadoEm).getTime() < PENDENTE_EM_ANDAMENTO_MS) {
    throw new Error(
      `Há uma emissão em andamento (DPS nº ${p.nDPS}, iniciada às ` +
        `${new Date(p.criadoEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}). ` +
        'Espere uns minutos e confira a lista de notas antes de tentar de novo.',
    );
  }
  try {
    const st = await api.fetchDpsStatus(p.idDps);
    const r = await api.fetchByChave(st.chaveAcesso);
    const nota = await guardarNota(producao, r.xmlNfse, r.nfse, {
      cliente: p.cliente, valorMoeda: p.valorMoeda, moeda: p.moeda, cotacao: p.cotacao,
    });
    await arm.confirmarNumero(amb, p.serie, p.nDPS);
    await arm.liberar(amb, p.idDps);
    return nota;
  } catch (e) {
    if (e instanceof NotFoundError) {
      await arm.liberar(amb, p.idDps);
      return 'livre';
    }
    throw new Error(
      `Há uma emissão sem confirmação (DPS nº ${p.nDPS}) e não consegui consultar a Receita agora ` +
        `(${explicarErro(e)}). Nada novo foi enviado. Tente de novo em alguns minutos.`,
    );
  }
}

/** Botão "verificar emissão pendente". */
export async function verificarPendente(producao: boolean): Promise<Resultado> {
  try {
    const empresa = await carregarEmpresa();
    const cert = carregarCertificado(empresa);
    if (!(await arm.pendente(arm.nomeAmb(producao)))) return { tipo: 'info', mensagem: 'Não há emissão pendente.' };
    const api = fabricaApi(producao, cert.pfx, cert.senha);
    try {
      const r = await resolverPendente(api, producao);
      if (r === 'livre') return { tipo: 'info', mensagem: 'A DPS pendente não chegou a virar nota. Liberado para emitir.' };
      return { tipo: 'pendente-resolvida', nota: r };
    } finally {
      await api.close();
    }
  } catch (e) {
    return { tipo: 'erro', ...mensagemErro(e) };
  }
}

/**
 * Emite de verdade. `cotacao` é a mesma mostrada na prévia, para o valor em
 * reais não mudar entre a confirmação e o envio.
 */
export async function emitir(p: Pedido, cotacao: Cotacao): Promise<Resultado> {
  let api: Api | undefined;
  try {
    validarPedido(p);
    const empresa = await carregarEmpresa();
    const cliente = await carregarCliente(p.apelido, empresa);
    const cert = carregarCertificado(empresa);
    if (cert.dias < 0) throw new Error('O certificado está vencido.');
    if (cotacao.moeda !== cliente.moeda || !(cotacao.valor > 0)) throw new Error('Cotação inválida — refaça a prévia.');
    const amb = arm.nomeAmb(p.producao);
    api = fabricaApi(p.producao, cert.pfx, cert.senha);

    const pend = await resolverPendente(api, p.producao);
    if (pend !== 'livre') return { tipo: 'pendente-resolvida', nota: pend };

    const descricao = preencherDescricao(p.descricao?.trim() || cliente.descricao, p.competencia);
    const nDPS = await arm.proximoNumero(amb, empresa.serie);
    const nota = montarDps({
      empresa, cliente, nDPS, producao: p.producao, valorMoeda: p.valorMoeda, cotacao,
      competencia: p.competencia, descricao,
    });

    const reservado = await arm.reservar(amb, {
      nDPS,
      serie: empresa.serie,
      idDps: nota.idDps,
      cliente: p.apelido,
      valorMoeda: p.valorMoeda,
      moeda: cliente.moeda,
      valorReais: nota.valorReais,
      cotacao: cotacao.valor,
      competencia: p.competencia,
      criadoEm: new Date().toISOString(),
    });
    if (!reservado) throw new Error('Outra emissão começou ao mesmo tempo. Confira a lista de notas e tente de novo.');

    try {
      const r = await api.emitirDpsPronta(nota.dps, { skipCepValidation: true });
      const resumo = await guardarNota(p.producao, r.xmlNfse, r.nfse, {
        cliente: p.apelido, valorMoeda: p.valorMoeda, moeda: cliente.moeda, cotacao: cotacao.valor,
      });
      await arm.confirmarNumero(amb, empresa.serie, nDPS);
      await arm.liberar(amb, nota.idDps);
      return { tipo: 'emitida', nota: resumo, alertas: r.alertas.map((a) => `[${a.codigo}] ${a.descricao}`) };
    } catch (e) {
      if (e instanceof ReceitaRejectionError) {
        await arm.liberar(amb, nota.idDps);
        if (e.mensagens.some((m) => m.codigo === 'E0014')) {
          // Número já usado (ex.: notas emitidas antes pela linha de comando). Avança o contador.
          await arm.confirmarNumero(amb, empresa.serie, nDPS);
          const m = mensagemErro(e);
          return { tipo: 'erro', ...m, detalhes: [...(m.detalhes ?? []), `O nº ${nDPS} já foi usado nessa série. Avancei o contador — tente de novo.`] };
        }
        throw e;
      }
      if (
        e instanceof ValidationError ||
        e instanceof UnauthorizedError ||
        e instanceof ForbiddenError ||
        e instanceof InvalidCertificateError
      ) {
        await arm.liberar(amb, nota.idDps); // não chegou a ser processado
        throw e;
      }
      // Rede, timeout, 5xx, 429 ou inesperado: não dá para saber. O pendente fica.
      return {
        tipo: 'incerto',
        mensagem:
          `Não consegui confirmar se a nota foi gerada (${explicarErro(e)}). ` +
          'Espere uns minutos e use "Verificar emissão pendente" (ou tente emitir de novo): ' +
          'antes de reenviar, o app pergunta à Receita se essa DPS já virou nota, então não há risco de duplicar.',
      };
    }
  } catch (e) {
    return { tipo: 'erro', ...mensagemErro(e) };
  } finally {
    await api?.close();
  }
}

/** Baixa uma nota pela chave de acesso e guarda no banco (ex.: notas emitidas pelo site). */
export async function importarPorChave(chave: string, producao: boolean): Promise<Resultado> {
  try {
    const empresa = await carregarEmpresa();
    const cert = carregarCertificado(empresa);
    const api = fabricaApi(producao, cert.pfx, cert.senha);
    try {
      const r = await api.fetchByChave(chave.replace(/\s/g, ''));
      const nota = await guardarNota(producao, r.xmlNfse, r.nfse, {
        cliente: null, valorMoeda: null, moeda: null, cotacao: null,
      });
      return { tipo: 'pendente-resolvida', nota };
    } finally {
      await api.close();
    }
  } catch (e) {
    return { tipo: 'erro', ...mensagemErro(e) };
  }
}

export async function cancelar(
  id: number,
  motivo: string,
  servicoNaoPrestado: boolean,
): Promise<{ ok: true } | { ok: false; mensagem: string; detalhes?: string[] }> {
  try {
    motivo = motivo.trim();
    if (motivo.length < 15 || motivo.length > 255) throw new Error('O motivo precisa ter entre 15 e 255 caracteres.');
    const linha = await arm.buscarNota(id);
    if (!linha) throw new Error('Nota não encontrada.');
    if (linha.cancelada_em) throw new Error('Essa nota já foi cancelada.');
    const producao = linha.ambiente === 'producao';
    const empresa = await carregarEmpresa();
    const cert = carregarCertificado(empresa);
    const api = fabricaApi(producao, cert.pfx, cert.senha);
    try {
      const res = await api.cancelar({
        chaveAcesso: linha.chave,
        autor: { CNPJ: empresa.cnpj },
        cMotivo: servicoNaoPrestado
          ? JustificativaCancelamento.ServicoNaoPrestado
          : JustificativaCancelamento.ErroEmissao,
        xMotivo: motivo,
        tpAmb: producao ? TipoAmbienteDps.Producao : TipoAmbienteDps.Homologacao,
        retryStore: createInMemoryRetryStore(),
      });
      if (res.status !== 'ok') {
        throw new Error(`A Receita não respondeu (${explicarErro(res.error)}). Tente de novo — repetir é seguro.`);
      }
      await arm.marcarCancelada(linha.chave, res.evento.xmlEvento);
      return { ok: true };
    } finally {
      await api.close();
    }
  } catch (e) {
    return { ok: false, ...mensagemErro(e) };
  }
}

export async function pdfDaNota(xml: string): Promise<Buffer> {
  return pdfDeNfse(parseNfseXml(xml));
}

export async function pdfDeNfse(nfse: NFSe): Promise<Buffer> {
  const producao = nfse.infNFSe.DPS.infDPS.tpAmb === TipoAmbienteDps.Producao;
  const obs = observacoesDanfse(nfse);
  return gerarDanfse(nfse, {
    ambiente: producao ? Ambiente.Producao : Ambiente.ProducaoRestrita,
    ...(obs ? { observacoes: obs } : {}),
  });
}

export interface ItemVerificacao {
  nome: string;
  ok: boolean | 'aviso';
  detalhe: string;
}

/** Equivalente ao `npm run verificar`. `testarReceita` faz a chamada mTLS (lenta). */
export async function verificar(testarReceita: false | { producao: boolean }): Promise<ItemVerificacao[]> {
  const itens: ItemVerificacao[] = [];
  const add = (nome: string, ok: boolean | 'aviso', detalhe: string) => itens.push({ nome, ok, detalhe });

  let empresa;
  try {
    empresa = await carregarEmpresa();
    add('Empresa', true, `CNPJ ${empresa.cnpj}, município ${empresa.codigoMunicipio}, série ${empresa.serie}`);
  } catch (e) {
    add('Empresa', false, explicarErro(e));
  }

  if (empresa) {
    const lista = await listarClientesBrutos();
    if (!lista.length) add('Clientes', false, 'Nenhum cliente cadastrado.');
    for (const c of lista) {
      try {
        const cli = await carregarCliente(c.apelido, empresa);
        add(`Cliente "${c.apelido}"`, true, `${cli.nome} (${cli.endereco.pais}, ${cli.moeda})`);
      } catch (e) {
        add(`Cliente "${c.apelido}"`, false, explicarErro(e));
      }
    }
  }

  let cert;
  try {
    cert = carregarCertificado(empresa);
    const val = cert.validade.toLocaleDateString('pt-BR');
    if (cert.dias < 0) add('Certificado', false, `${cert.titular} — VENCIDO em ${val}`);
    else add('Certificado', cert.dias < 30 ? 'aviso' : true, `${cert.titular} — válido até ${val} (${cert.dias} dias)`);
  } catch (e) {
    add('Certificado', false, explicarErro(e));
  }

  if (testarReceita && cert && empresa) {
    const nome = testarReceita.producao ? 'produção' : 'testes';
    const api = fabricaApi(testarReceita.producao, cert.pfx, cert.senha);
    try {
      const r = await api.consultarConvenio(empresa.codigoMunicipio);
      const pc = r.parametrosConvenio;
      add(
        `Conexão com a Receita (${nome})`,
        true,
        pc
          ? `mTLS OK. Município aderente ao Emissor Nacional: ${pc.aderenteEmissorNacional}; ao Ambiente Nacional: ${pc.aderenteAmbienteNacional}`
          : `mTLS OK. ${r.mensagem ?? ''}`,
      );
    } catch (e) {
      add(`Conexão com a Receita (${nome})`, false, explicarErro(e));
    } finally {
      await api.close();
    }
  }

  try {
    const cot = await buscarPtax('USD', empresa?.cotacao.tipo ?? 'venda');
    add('Banco Central (PTAX)', true, `${cot.fonte} de ${cot.data.split('-').reverse().join('/')}: ${cot.valor}`);
  } catch (e) {
    add('Banco Central (PTAX)', 'aviso', `${(e as Error).message} — dá para informar a cotação na mão`);
  }

  for (const amb of ['producao', 'testes'] as const) {
    const p = await arm.pendente(amb);
    if (p) add(`Emissão pendente (${amb})`, 'aviso', `DPS nº ${p.nDPS} para "${p.cliente}" sem confirmação`);
  }
  return itens;
}
