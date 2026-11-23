#!/usr/bin/env node
/**
 * Emissor de NFS-e (padrão nacional) — exportação de serviços.
 *
 *   npm run verificar                         confere config, certificado e conexão
 *   npm run cotacao                           mostra a PTAX que seria usada hoje
 *   npm run nota -- <cliente> --valor 2500    emite (ambiente de TESTES por padrão)
 *   npm run consultar -- <chave>              baixa XML e PDF de uma nota
 *   npm run cancelar -- <chave> --motivo "…"  cancela uma nota
 *   npm run pdf -- <arquivo.xml>              gera o PDF de novo a partir do XML
 *
 * Acrescente --producao para usar o ambiente real.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
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
  parsePfx,
  ReceitaRejectionError,
  TipoAmbienteDps,
  UnauthorizedError,
  ValidationError,
  type NFSe,
} from 'open-nfse';
import type { NfseClientLike } from 'open-nfse/testing';
import {
  carregarCertificado,
  carregarCliente,
  carregarEmpresa,
  listarClientes,
  RAIZ,
  type Empresa,
} from './config';
import { buscarPtax, hojeBrasilia, type Cotacao } from './cotacao';
import { brl, dataBr, montarDps, moeda, preencherDescricao } from './dps';
import { Armazem } from './estado';
import { DICAS, explicarErro, observacoesDanfse } from './nucleo';

// ---------------------------------------------------------------------------
// Utilidades de terminal

const ok = (m: string) => console.log(`✓ ${m}`);
const aviso = (m: string) => console.log(`⚠ ${m}`);
const linha = () => console.log('─'.repeat(60));

async function perguntar(texto: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Confirmação necessária, mas o terminal não é interativo. Use --sim para pular.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(texto)).trim();
  } finally {
    rl.close();
  }
}

/** Aceita 2500, 2500.5, 2.500,50 e 2,500.50. */
function lerValor(bruto: string | undefined, nome: string): number {
  if (!bruto) throw new Error(`Informe: ${nome}.`);
  let s = bruto.replace(/[^\d.,]/g, '');
  const ultVirg = s.lastIndexOf(',');
  const ultPonto = s.lastIndexOf('.');
  if (ultVirg > ultPonto) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${nome} inválido: "${bruto}"`);
  return n;
}

function lerData(bruto: string, nome: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bruto) || Number.isNaN(Date.parse(`${bruto}T12:00:00Z`))) {
    throw new Error(`${nome} deve estar no formato AAAA-MM-DD (ex.: 2026-11-30).`);
  }
  return bruto;
}

const nomeAmbiente = (producao: boolean) => (producao ? 'PRODUÇÃO (nota real)' : 'TESTES (sem valor fiscal)');

// ---------------------------------------------------------------------------
// Certificado e cliente da API

function prepararCertificado(empresa?: Empresa) {
  const cfg = carregarCertificado();
  const pfx = readFileSync(cfg.arquivo);
  const cert = parsePfx(pfx, cfg.senha); // lança se senha errada / vencido / corrompido

  const cnpjCert = cert.subject.match(/\d{14}/)?.[0];
  if (empresa && cnpjCert && cnpjCert !== empresa.cnpj) {
    throw new Error(
      `O certificado é do CNPJ ${cnpjCert}, mas config/empresa.json diz ${empresa.cnpj}. ` +
        'A Receita exige o certificado do próprio CNPJ emissor.',
    );
  }
  const dias = Math.floor((cert.expiresOn.getTime() - Date.now()) / 86_400_000);
  return { pfx, senha: cfg.senha, cert, cnpjCert, dias };
}

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

const criarApi = (producao: boolean, pfx: Buffer, senha: string) => fabricaApi(producao, pfx, senha);

// ---------------------------------------------------------------------------
// Salvar nota autorizada (XML + PDF)

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40);

async function salvarNota(
  api: Api,
  arm: Armazem,
  xmlNfse: string,
  nfse: NFSe,
  apelido?: string,
) {
  const inf = nfse.infNFSe;
  const dps = inf.DPS.infDPS;
  const competencia = dps.dCompet.toISOString().slice(0, 7);
  const quem = apelido ?? slug(dps.toma?.xNome ?? 'sem-tomador');
  const base = path.join(arm.pastaNotas, `${competencia}_${quem}_nfse-${inf.nNFSe}`);
  writeFileSync(`${base}.xml`, xmlNfse);
  const obs = observacoesDanfse(nfse);
  const pdf = await api.gerarDanfse(nfse, {
    ambiente: arm.producao ? Ambiente.Producao : Ambiente.ProducaoRestrita,
    ...(obs ? { observacoes: obs } : {}),
  });
  writeFileSync(`${base}.pdf`, pdf);
  return { xml: `${base}.xml`, pdf: `${base}.pdf` };
}

function mostrarNota(nfse: NFSe) {
  const inf = nfse.infNFSe;
  const dps = inf.DPS.infDPS;
  console.log(`  Número da NFS-e : ${inf.nNFSe}`);
  console.log(`  Chave de acesso : ${inf.chaveAcesso}`);
  console.log(`  Tomador         : ${dps.toma?.xNome ?? '—'}`);
  console.log(`  Valor           : ${brl(dps.valores.vServPrest.vServ)}`);
  console.log(`  Processada em   : ${inf.dhProc.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
}

// ---------------------------------------------------------------------------
// Comandos

export async function cmdVerificar(producao: boolean) {
  console.log(`Verificando a configuração (ambiente: ${nomeAmbiente(producao)})\n`);
  let falhas = 0;

  let empresa: Empresa | undefined;
  try {
    empresa = carregarEmpresa();
    ok(`config/empresa.json — CNPJ ${empresa.cnpj}, município ${empresa.codigoMunicipio}, série ${empresa.serie}`);
  } catch (e) {
    falhas++;
    console.log(`✗ ${(e as Error).message}`);
  }

  const clientes = listarClientes();
  if (!clientes.length) {
    falhas++;
    console.log('✗ Nenhum cliente em config/clientes/ — copie cliente.exemplo.json');
  }
  for (const c of clientes) {
    if (!empresa) break;
    try {
      const cli = carregarCliente(c, empresa);
      ok(`cliente "${c}" — ${cli.nome} (${cli.endereco.pais}, ${cli.moeda})`);
    } catch (e) {
      falhas++;
      console.log(`✗ ${(e as Error).message}`);
    }
  }

  let api: Api | undefined;
  try {
    const c = prepararCertificado(empresa);
    ok(`certificado — ${c.cert.subject.split(',')[0]}`);
    if (c.dias < 30) aviso(`o certificado vence em ${c.dias} dias (${c.cert.expiresOn.toLocaleDateString('pt-BR')})`);
    else ok(`certificado válido até ${c.cert.expiresOn.toLocaleDateString('pt-BR')}`);
    api = criarApi(producao, c.pfx, c.senha);
  } catch (e) {
    falhas++;
    console.log(`✗ ${explicarErro(e)}`);
  }

  if (api && empresa) {
    try {
      const r = await api.consultarConvenio(empresa.codigoMunicipio);
      const p = r.parametrosConvenio;
      ok('conexão com a Receita (mTLS com o certificado) funcionando');
      if (p) {
        console.log(`  Município aderente ao Emissor Nacional: ${p.aderenteEmissorNacional}`);
        console.log(`  Município aderente ao Ambiente Nacional: ${p.aderenteAmbienteNacional}`);
      } else if (r.mensagem) {
        console.log(`  ${r.mensagem}`);
      }
    } catch (e) {
      falhas++;
      console.log(`✗ Não consegui falar com a Receita: ${explicarErro(e)}`);
    } finally {
      await api.close();
    }
  }

  try {
    const cot = await buscarPtax('USD', empresa?.cotacao.tipo ?? 'venda');
    ok(`Banco Central — ${cot.fonte} de ${dataBr(cot.data)}: ${cot.valor}`);
  } catch (e) {
    aviso(`não consegui buscar a PTAX (${(e as Error).message}); dá pra informar com --cotacao`);
  }

  console.log();
  if (falhas) {
    console.log(`${falhas} problema(s) para resolver antes de emitir.`);
    process.exitCode = 1;
  } else {
    console.log('Tudo certo. Próximo passo: npm run nota -- <cliente> --valor <valor> (em testes)');
  }
}

export async function cmdCotacao(valores: Record<string, string | boolean | undefined>) {
  const m = String(valores.moeda ?? 'USD').toUpperCase();
  const data = valores.data ? lerData(String(valores.data), '--data') : hojeBrasilia();
  const [venda, compra] = await Promise.all([buscarPtax(m, 'venda', data), buscarPtax(m, 'compra', data)]);
  console.log(`PTAX ${m} do dia útil anterior a ${dataBr(data)} → ${dataBr(venda.data)}`);
  console.log(`  venda : ${venda.valor}`);
  console.log(`  compra: ${compra.valor}`);
}

async function resolverPendente(api: Api, arm: Armazem): Promise<'emitida' | 'livre'> {
  const p = arm.pendente();
  if (!p) return 'livre';
  console.log(
    `Há uma emissão que ficou sem confirmação: DPS nº ${p.nDPS} para "${p.cliente}" ` +
      `(${moeda(p.valorMoeda, p.moeda)}), de ${new Date(p.criadoEm).toLocaleString('pt-BR')}.`,
  );
  console.log('Consultando a Receita antes de qualquer coisa…');
  try {
    const st = await api.fetchDpsStatus(p.idDps);
    const r = await api.fetchByChave(st.chaveAcesso);
    const arq = await salvarNota(api, arm, r.xmlNfse, r.nfse, p.cliente);
    arm.confirmarNumero(p.serie, p.nDPS);
    arm.definirPendente(null);
    arm.registrar({
      dataEmissao: hojeBrasilia(),
      numeroNfse: r.nfse.infNFSe.nNFSe,
      nDPS: p.nDPS,
      cliente: p.cliente,
      competencia: p.competencia,
      valorMoeda: p.valorMoeda,
      moeda: p.moeda,
      cotacao: p.cotacao,
      valorReais: p.valorReais,
      chave: r.chaveAcesso,
      arquivoPdf: arq.pdf,
    });
    ok('Essa nota FOI emitida. Salvei os arquivos:');
    mostrarNota(r.nfse);
    console.log(`  PDF: ${path.relative(RAIZ, arq.pdf)}`);
    return 'emitida';
  } catch (e) {
    if (e instanceof NotFoundError) {
      arm.definirPendente(null);
      ok('Ela não chegou a ser gerada. Seguindo normalmente (o número será reaproveitado).\n');
      return 'livre';
    }
    aviso('Não consegui consultar agora. Nada novo será enviado até a Receita responder sobre essa DPS.');
    throw e;
  }
}

export async function cmdNota(apelido: string | undefined, v: Record<string, string | boolean | undefined>) {
  if (!apelido) {
    const lista = listarClientes();
    throw new Error(
      `Diga para qual cliente: npm run nota -- <cliente> --valor 2500` +
        (lista.length ? `\nClientes: ${lista.join(', ')}` : ''),
    );
  }
  const producao = Boolean(v.producao);
  const simular = Boolean(v.simular);
  const empresa = carregarEmpresa();
  const cliente = carregarCliente(apelido, empresa);
  const valorMoeda = lerValor(v.valor as string | undefined, `Valor em ${cliente.moeda} (--valor)`);
  const hoje = hojeBrasilia();
  const competencia = v.competencia ? lerData(String(v.competencia), '--competencia') : hoje;
  if (competencia > hoje) throw new Error('A competência não pode ser uma data futura.');

  const c = prepararCertificado(empresa);
  if (c.dias < 0) throw new Error('O certificado está vencido.');
  if (c.dias < 30) aviso(`seu certificado vence em ${c.dias} dias — providencie a renovação.`);

  const arm = new Armazem(producao);
  const api = criarApi(producao, c.pfx, c.senha);
  try {
    if (!simular && (await resolverPendente(api, arm)) === 'emitida') {
      console.log('\nSe você precisa de mais uma nota, rode o comando de novo.');
      return;
    }

    let cotacao: Cotacao;
    if (v.cotacao) {
      cotacao = {
        moeda: cliente.moeda,
        tipo: empresa.cotacao.tipo,
        valor: lerValor(String(v.cotacao), 'Cotação (--cotacao)'),
        data: hoje,
        fonte: 'cotação informada manualmente',
      };
    } else {
      cotacao = await buscarPtax(cliente.moeda, empresa.cotacao.tipo, hoje);
    }

    const descricao = preencherDescricao(String(v.descricao ?? cliente.descricao), competencia);
    if (descricao.length > 2000) throw new Error('A descrição passou de 2000 caracteres.');

    const nDPS = arm.proximoNumero(empresa.serie);
    const nota = montarDps({ empresa, cliente, nDPS, producao, valorMoeda, cotacao, competencia, descricao });

    // Validação local completa (XSD oficial + assinatura) antes de qualquer envio.
    const previa = await api.emitirDpsPronta(nota.dps, { dryRun: true, skipCepValidation: true });

    linha();
    console.log(`  Ambiente    : ${nomeAmbiente(producao)}`);
    console.log(`  Cliente     : ${cliente.nome}`);
    console.log(`  Competência : ${dataBr(competencia)}`);
    console.log(`  Valor       : ${moeda(valorMoeda, cliente.moeda)}`);
    console.log(`  Cotação     : ${cotacao.valor} — ${cotacao.fonte}${cotacao.fonte.startsWith('PTAX') ? ` de ${dataBr(cotacao.data)}` : ''}`);
    console.log(`  Valor da nota: ${brl(nota.valorReais)}`);
    console.log(`  Tributação  : exportação de serviço (sem ISS), resultado em ${cliente.paisResultado}`);
    console.log(`  Descrição   : ${descricao}`);
    console.log(`  DPS         : série ${empresa.serie}, nº ${nDPS}`);
    linha();

    if (simular) {
      const pasta = path.join(arm.pastaNotas, 'simulacoes');
      mkdirSync(pasta, { recursive: true });
      const arq = path.join(pasta, `dps_${apelido}_${Date.now()}.xml`);
      writeFileSync(arq, previa.xmlDpsAssinado);
      ok(`Simulação OK: XML validado no schema oficial e assinado. Nada foi enviado.`);
      console.log(`  XML: ${path.relative(RAIZ, arq)}`);
      return;
    }

    if (!v.sim) {
      if (producao) {
        const r = await perguntar('Isso gera uma nota fiscal REAL. Digite EMITIR para confirmar: ');
        if (r !== 'EMITIR') return console.log('Cancelado. Nada foi enviado.');
      } else {
        const r = await perguntar('Enviar para o ambiente de testes? (s/N) ');
        if (!/^s(im)?$/i.test(r)) return console.log('Cancelado. Nada foi enviado.');
      }
    }

    arm.definirPendente({
      nDPS,
      serie: empresa.serie,
      idDps: nota.idDps,
      cliente: apelido,
      valorMoeda,
      moeda: cliente.moeda,
      valorReais: nota.valorReais,
      cotacao: cotacao.valor,
      competencia,
      criadoEm: new Date().toISOString(),
    });

    try {
      const r = await api.emitirDpsPronta(nota.dps, { skipCepValidation: true });
      const arq = await salvarNota(api, arm, r.xmlNfse, r.nfse, apelido);
      arm.confirmarNumero(empresa.serie, nDPS);
      arm.definirPendente(null);
      arm.registrar({
        dataEmissao: hoje,
        numeroNfse: r.nfse.infNFSe.nNFSe,
        nDPS,
        cliente: apelido,
        competencia,
        valorMoeda,
        moeda: cliente.moeda,
        cotacao: cotacao.valor,
        valorReais: nota.valorReais,
        chave: r.chaveAcesso,
        arquivoPdf: arq.pdf,
      });
      console.log();
      ok(producao ? 'Nota fiscal emitida!' : 'Nota de TESTE autorizada (sem valor fiscal).');
      mostrarNota(r.nfse);
      console.log(`  PDF: ${path.relative(RAIZ, arq.pdf)}`);
      console.log(`  XML: ${path.relative(RAIZ, arq.xml)}`);
      for (const a of r.alertas) aviso(`Receita: [${a.codigo}] ${a.descricao}`);
    } catch (e) {
      if (e instanceof ReceitaRejectionError) {
        arm.definirPendente(null);
        if (e.mensagens.some((m) => m.codigo === 'E0014')) {
          // Número já usado (ex.: estado local apagado). Avança o contador.
          arm.confirmarNumero(empresa.serie, nDPS);
          aviso(`O nº ${nDPS} já foi usado nessa série. Avancei o contador — rode o comando de novo.`);
        }
        throw e;
      }
      if (
        e instanceof ValidationError ||
        e instanceof UnauthorizedError ||
        e instanceof ForbiddenError ||
        e instanceof InvalidCertificateError
      ) {
        // Não chegou a ser processado: libera o número.
        arm.definirPendente(null);
        throw e;
      }
      // Rede, timeout, 5xx, 429 ou algo inesperado: não dá pra saber se a nota foi gerada.
      console.log();
      aviso(`Não consegui confirmar se a nota foi gerada (${explicarErro(e)}).`);
      console.log(
        '  Rode o mesmo comando de novo. Antes de reenviar, o app pergunta à Receita se essa DPS\n' +
          '  já virou nota — então não existe risco de emitir duas vezes.',
      );
      process.exitCode = 1;
    }
  } finally {
    await api.close();
  }
}

export async function cmdConsultar(chave: string | undefined, producao: boolean) {
  if (!chave) throw new Error('Informe a chave de acesso: npm run consultar -- <chave>');
  const empresa = carregarEmpresa();
  const c = prepararCertificado(empresa);
  const arm = new Armazem(producao);
  const api = criarApi(producao, c.pfx, c.senha);
  try {
    const r = await api.fetchByChave(chave.replace(/\s/g, ''));
    const arq = await salvarNota(api, arm, r.xmlNfse, r.nfse);
    mostrarNota(r.nfse);
    console.log(`  Situação        : ${r.nfse.infNFSe.cStat}`);
    console.log(`  PDF: ${path.relative(RAIZ, arq.pdf)}`);
  } finally {
    await api.close();
  }
}

export async function cmdCancelar(chave: string | undefined, v: Record<string, string | boolean | undefined>) {
  if (!chave) throw new Error('Informe a chave: npm run cancelar -- <chave> --motivo "texto"');
  const motivo = String(v.motivo ?? '').trim();
  if (motivo.length < 15 || motivo.length > 255) {
    throw new Error('O motivo (--motivo) precisa ter entre 15 e 255 caracteres.');
  }
  const producao = Boolean(v.producao);
  const empresa = carregarEmpresa();
  const c = prepararCertificado(empresa);
  const api = criarApi(producao, c.pfx, c.senha);
  try {
    const nota = await api.fetchByChave(chave.replace(/\s/g, ''));
    console.log(`Nota a cancelar (${nomeAmbiente(producao)}):`);
    mostrarNota(nota.nfse);
    console.log(`  Motivo          : ${motivo}`);
    if (!v.sim) {
      const r = await perguntar('Digite CANCELAR para confirmar: ');
      if (r !== 'CANCELAR') return console.log('Nada foi feito.');
    }
    const res = await api.cancelar({
      chaveAcesso: nota.chaveAcesso,
      autor: { CNPJ: empresa.cnpj },
      cMotivo: v['servico-nao-prestado']
        ? JustificativaCancelamento.ServicoNaoPrestado
        : JustificativaCancelamento.ErroEmissao,
      xMotivo: motivo,
      tpAmb: producao ? TipoAmbienteDps.Producao : TipoAmbienteDps.Homologacao,
      retryStore: createInMemoryRetryStore(),
    });
    if (res.status === 'ok') {
      const arm = new Armazem(producao);
      const arq = path.join(arm.pastaNotas, `cancelamento_nfse-${nota.nfse.infNFSe.nNFSe}.xml`);
      writeFileSync(arq, res.evento.xmlEvento);
      ok('Nota cancelada.');
      console.log(`  Comprovante: ${path.relative(RAIZ, arq)}`);
    } else {
      aviso(`A Receita não respondeu (${explicarErro(res.error)}). Rode o comando de novo — repetir é seguro.`);
      process.exitCode = 1;
    }
  } finally {
    await api.close();
  }
}

export async function cmdPdf(arquivo: string | undefined) {
  if (!arquivo) throw new Error('Informe o XML: npm run pdf -- notas/producao/arquivo.xml');
  const xml = readFileSync(path.resolve(arquivo), 'utf8');
  const nfse = parseNfseXml(xml);
  const producao = nfse.infNFSe.DPS.infDPS.tpAmb === TipoAmbienteDps.Producao;
  const obs = observacoesDanfse(nfse);
  const pdf = await gerarDanfse(nfse, {
    ambiente: producao ? Ambiente.Producao : Ambiente.ProducaoRestrita,
    ...(obs ? { observacoes: obs } : {}),
  });
  const destino = path.resolve(arquivo).replace(/\.xml$/i, '') + '.pdf';
  writeFileSync(destino, pdf);
  ok(`PDF gerado: ${path.relative(process.cwd(), destino)}`);
}

function imprimirErro(e: unknown) {
  console.log();
  if (e instanceof ReceitaRejectionError) {
    console.log('✗ A Receita rejeitou a nota:');
    for (const m of e.mensagens) {
      console.log(`  [${m.codigo}] ${m.descricao}${m.complemento ? ` — ${m.complemento}` : ''}`);
      if (DICAS[m.codigo]) console.log(`    → ${DICAS[m.codigo]}`);
    }
    console.log('  Nenhuma nota foi gerada.');
  } else {
    console.log(`✗ ${explicarErro(e)}`);
  }
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      producao: { type: 'boolean' },
      valor: { type: 'string' },
      cotacao: { type: 'string' },
      competencia: { type: 'string' },
      descricao: { type: 'string' },
      simular: { type: 'boolean' },
      sim: { type: 'boolean' },
      motivo: { type: 'string' },
      'servico-nao-prestado': { type: 'boolean' },
      moeda: { type: 'string' },
      data: { type: 'string' },
    },
  });
  const [comando, arg] = positionals;
  switch (comando) {
    case 'verificar':
      return cmdVerificar(Boolean(values.producao));
    case 'cotacao':
      return cmdCotacao(values);
    case 'nota':
      return cmdNota(arg, values);
    case 'consultar':
      return cmdConsultar(arg, Boolean(values.producao));
    case 'cancelar':
      return cmdCancelar(arg, values);
    case 'pdf':
      return cmdPdf(arg);
    default:
      console.log('Comandos: verificar, cotacao, nota, consultar, cancelar, pdf (veja o README).');
  }
}

const executadoDireto =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (executadoDireto) main().catch(imprimirErro);

export { imprimirErro };
