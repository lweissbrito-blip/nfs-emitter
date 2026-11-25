/**
 * Teste do fluxo web contra a Receita simulada (NfseClientFake) e um Postgres
 * de teste. Rode com:
 *   DATABASE_URL=postgres://... CERT_TESTE_PFX=caminho.pfx CERT_TESTE_SENHA=... npm run teste:web
 * ATENÇÃO: apaga as tabelas do banco indicado. Nunca aponte para o banco de produção.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import type { DpsNt009 } from 'open-nfse';
import { NfseClientFake } from 'open-nfse/testing';
import type { Cotacao } from '../src/cotacao';
import { hojeBrasilia } from '../src/cotacao';
import * as arm from './armazem';
import { salvarCliente, salvarEmpresa } from './config';
import { fecharConexao, sql } from './db';
import { cancelar, emitir, verificar, pdfDeNfse, previa, usarFabricaApi, verificarPendente } from './emissao';

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Os testes só rodam contra um Postgres local (DATABASE_URL com localhost).');
}

const fake = new NfseClientFake({ layout: 'nt009' });
fake.close = async () => {}; // o mesmo fake é reaproveitado entre chamadas
usarFabricaApi(() => fake);

const pedido = {
  apelido: 'acme',
  producao: false,
  valorMoeda: 2500,
  competencia: hojeBrasilia(),
};
const cotacao: Cotacao = { moeda: 'USD', tipo: 'venda', valor: 5.5, data: hojeBrasilia(), fonte: 'cotação informada manualmente' };

before(async () => {
  process.env.CERT_PFX_BASE64 = readFileSync(process.env.CERT_TESTE_PFX!).toString('base64');
  process.env.CERT_SENHA = process.env.CERT_TESTE_SENHA!;
  // Banco limpo: apaga as tabelas antes do app criar o esquema.
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query('drop table if exists configuracao, clientes, estado, notas');
  await c.end();
  const empresa = await salvarEmpresa({
    cnpj: '11.222.333/0001-81',
    codigoMunicipio: '3523107',
    serie: '1',
    aliquotaSimplesAproximada: 6,
    servico: { codigoTributacaoNacional: '010101', codigoNBS: '115013000' },
    cotacao: { tipo: 'venda' },
  });
  await salvarCliente(
    'acme',
    {
      nome: 'ACME Corp',
      endereco: {
        pais: 'US', logradouro: 'Main St', numero: '100', bairro: 'Downtown',
        cidade: 'Miami', estado: 'FL', codigoPostal: '33101',
      },
      moeda: 'USD',
      descricao: 'Serviços de design referentes a {mesAno}.',
    },
    empresa,
  );
});

after(fecharConexao);

test('prévia valida e não consome número', async () => {
  const p = await previa({ ...pedido, cotacaoManual: 5.5 });
  assert.equal(p.valorReais, 13750);
  assert.equal(p.nDPS, '1');
  assert.equal(await arm.proximoNumero('testes', '1'), '1');
});

test('emissão normal grava a nota e avança o número', async () => {
  const r = await emitir(pedido, cotacao);
  assert.equal(r.tipo, 'emitida', JSON.stringify(r));
  assert.equal(await arm.proximoNumero('testes', '1'), '2');
  assert.equal(await arm.pendente('testes'), null);
  const [n] = await arm.listarNotas('testes');
  assert.equal(n.cliente, 'acme');
  // O XML sintético do fake é incompleto para o parser real; o PDF é testado a partir do objeto.
  const pdf = await pdfDeNfse((await fake.fetchByChave(n.chave)).nfse);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});

test('rejeição da Receita libera o pendente e não consome número', async () => {
  fake.failNextEmit({ kind: 'rejection', codigo: 'E0116', descricao: 'IM obrigatória' });
  const r = await emitir(pedido, cotacao);
  assert.equal(r.tipo, 'erro');
  assert.match(JSON.stringify(r), /E0116/);
  assert.equal(await arm.pendente('testes'), null);
  assert.equal(await arm.proximoNumero('testes', '1'), '2');
});

test('falha de rede mantém o pendente e bloqueia nova emissão', async () => {
  fake.failNextEmit({ kind: 'transient', message: 'ECONNRESET' });
  const r = await emitir(pedido, cotacao);
  assert.equal(r.tipo, 'incerto', JSON.stringify(r));
  const p = await arm.pendente('testes');
  assert.equal(p?.nDPS, '2');

  // Logo em seguida: pode ser uma requisição ainda em andamento → recusa.
  const r2 = await emitir(pedido, cotacao);
  assert.equal(r2.tipo, 'erro');
  assert.match(JSON.stringify(r2), /em andamento/);
  assert.equal((await arm.pendente('testes'))?.nDPS, '2');

  // Minutos depois: consulta a Receita; a DPS não existe → libera e reaproveita o número.
  await sql(`update estado set pendente = jsonb_set(pendente, '{criadoEm}', to_jsonb($1::text))`, [
    new Date(Date.now() - 10 * 60_000).toISOString(),
  ]);
  const v = await verificarPendente(false);
  assert.equal(v.tipo, 'info', JSON.stringify(v));
  assert.equal(await arm.pendente('testes'), null);
  const r3 = await emitir(pedido, cotacao);
  assert.equal(r3.tipo, 'emitida', JSON.stringify(r3));
  assert.equal(await arm.proximoNumero('testes', '1'), '3');
});

test('pendente que virou nota é recuperado, sem emitir outra', async () => {
  // Simula: a nota nº 3 foi enviada e autorizada, mas a resposta se perdeu.
  const antes = (await arm.listarNotas('testes')).length;
  const nota3 = await montarParaTeste('3');
  await fake.emitirDpsPronta(nota3.dps as DpsNt009, { skipCepValidation: true });
  await arm.reservar('testes', {
    nDPS: '3', serie: '1', idDps: nota3.idDps, cliente: 'acme',
    valorMoeda: 2500, moeda: 'USD', valorReais: 13750, cotacao: 5.5, competencia: pedido.competencia,
    criadoEm: new Date(Date.now() - 10 * 60_000).toISOString(),
  });
  const r = await emitir(pedido, cotacao);
  assert.equal(r.tipo, 'pendente-resolvida', JSON.stringify(r));
  assert.equal((await arm.listarNotas('testes')).length, antes + 1);
  assert.equal(await arm.proximoNumero('testes', '1'), '4');
  assert.equal(await arm.pendente('testes'), null);
});

test('reserva é exclusiva', async () => {
  const base = {
    serie: '1', cliente: 'acme', valorMoeda: 1, moeda: 'USD', valorReais: 5, cotacao: 5,
    competencia: pedido.competencia, criadoEm: new Date().toISOString(),
  };
  const [a, b] = await Promise.all([
    arm.reservar('testes', { ...base, nDPS: '4', idDps: 'A' }),
    arm.reservar('testes', { ...base, nDPS: '4', idDps: 'B' }),
  ]);
  assert.equal(Number(a) + Number(b), 1);
  assert.equal(await arm.reservar('testes', { ...base, nDPS: '5', idDps: 'C' }), false);
  await arm.liberar('testes', a ? 'A' : 'B');
});

test('cancelamento', async () => {
  const [n] = await arm.listarNotas('testes');
  const curto = await cancelar(n.id, 'curto', false);
  assert.equal(curto.ok, false);
  const r = await cancelar(n.id, 'Valor digitado errado na nota', false);
  assert.deepEqual(r, { ok: true });
  assert.ok((await arm.buscarNota(n.id))?.cancelada_em);
});

async function montarParaTeste(nDPS: string) {
  const { montarDps, preencherDescricao } = await import('../src/dps');
  const { carregarEmpresa, carregarCliente } = await import('./config');
  const empresa = await carregarEmpresa();
  const cliente = await carregarCliente('acme', empresa);
  return montarDps({
    layout: 'nt009', empresa, cliente, nDPS, producao: false, valorMoeda: 2500, cotacao,
    competencia: pedido.competencia, descricao: preencherDescricao(cliente.descricao, pedido.competencia),
  });
}

test('teste de conexão usa a SEFIN e trata o ADN fora do ar como aviso', async () => {
  const original = fake.consultarConvenio.bind(fake);
  fake.consultarConvenio = async () => {
    throw new (await import('open-nfse')).NetworkError('ECONNRESET');
  };
  try {
    const itens = await verificar({ producao: false });
    const conexao = itens.find((i) => i.nome.startsWith('Conexão'));
    const convenio = itens.find((i) => i.nome.startsWith('Convênio'));
    assert.equal(conexao?.ok, true, JSON.stringify(itens));
    assert.equal(convenio?.ok, 'aviso');
    assert.match(convenio!.detalhe, /ECONNRESET/);
  } finally {
    fake.consultarConvenio = original;
  }
});
