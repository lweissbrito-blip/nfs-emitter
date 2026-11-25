/**
 * A DPS que o app monta passa no XSD oficial e nas regras locais da lib nos
 * dois leiautes (dry run com o NfseClient real — nada é enviado).
 *   CERT_TESTE_PFX=... CERT_TESTE_SENHA=... npx tsx --test web/leiaute.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Ambiente, NfseClient, type Layout } from 'open-nfse';
import { montarDps, preencherDescricao } from '../src/dps';
import { leiauteDe } from '../src/leiaute';
import { validarCliente, validarEmpresa } from '../src/validacao';

const empresa = validarEmpresa({
  cnpj: '11222333000181', codigoMunicipio: '3523107', serie: '1', aliquotaSimplesAproximada: 6,
  servico: { codigoTributacaoNacional: '130301', codigoNBS: '125013900' }, cotacao: { tipo: 'venda' },
});
const cliente = validarCliente('acme', {
  nome: 'ACME LLC', nif: '47-3736427',
  endereco: { pais: 'US', logradouro: 'W Flagler St', numero: '1065', bairro: 'Downtown Miami', cidade: 'Miami', estado: 'FL', codigoPostal: '33130' },
  moeda: 'USD', descricao: 'Produção e edição de vídeos referentes a {mesAno}.',
}, empresa);

test('leiaute por ambiente e data', () => {
  assert.equal(leiauteDe(false, '2026-11-25'), 'nt009');
  assert.equal(leiauteDe(true, '2026-11-30'), 'nt004');
  assert.equal(leiauteDe(true, '2026-12-01'), 'nt009');
});

for (const layout of ['nt004', 'nt009'] as Layout[]) {
  test(`DPS válida no XSD e nas regras locais — ${layout}`, async () => {
    const competencia = '2026-11-20';
    const nota = montarDps({
      layout, empresa, cliente, nDPS: '1', producao: false, valorMoeda: 417,
      cotacao: { moeda: 'USD', tipo: 'venda', valor: 5.8873, data: '2026-11-19', fonte: 'PTAX venda USD (Banco Central)' },
      competencia, descricao: preencherDescricao(cliente.descricao, competencia),
    });
    const api = new NfseClient({
      layout,
      ambiente: Ambiente.ProducaoRestrita,
      certificado: { pfx: readFileSync(process.env.CERT_TESTE_PFX!), password: process.env.CERT_TESTE_SENHA! },
    });
    try {
      const r = await api.emitirDpsPronta(nota.dps as never, { dryRun: true, skipCepValidation: true });
      const xml = r.xmlDpsAssinado;
      if (layout === 'nt009') assert.match(xml, /<tpEmit>1<\/tpEmit><finNFSe>0<\/finNFSe><cLocEmi>/);
      else assert.doesNotMatch(xml, /finNFSe/);
      assert.match(xml, /<vServ>2455<\/vServ>/);
    } finally {
      await api.close();
    }
  });
}
