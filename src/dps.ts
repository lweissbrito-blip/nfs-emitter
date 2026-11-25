import {
  buildDpsId,
  CodigoNaoNif,
  EnvioMDIC,
  MecanismoApoioComExPrestador,
  MecanismoApoioComExTomador,
  ModoPrestacao,
  MovimentacaoTemporariaBens,
  OpcaoSimplesNacional,
  RegimeApuracaoSimplesNacional,
  RegimeEspecialTributacao,
  TipoAmbienteDps,
  TipoEmitenteDps,
  TipoRetISSQN,
  TipoTribISSQN,
  VinculoPrestacao,
  FinalidadeNFSe,
  type DPS,
  type InfoPessoaNt004,
  type Layout,
} from 'open-nfse';
import type { Cliente, Empresa } from './validacao';
import type { Cotacao } from './cotacao';

export const VERSAO_APP = 'lweiss-emissor/1.0';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * Vários campos do leiaute (nome, endereço, informações complementares) só
 * aceitam caracteres Latin-1, sem espaço nas pontas. Troca a tipografia comum
 * (aspas curvas, travessões, €) e descarta o que sobrar fora da faixa.
 */
export function latin1(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u20AC/g, 'EUR')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[^\u0020-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const arred2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const moeda = (n: number, codigo: string) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: codigo });

/** "USD 2.500,00" — sem símbolos fora do Latin-1 (o € não passa no schema). */
const valorTexto = (n: number, codigo: string) =>
  `${codigo} ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** AAAA-MM-DD → Date ao meio-dia de Brasília (evita virar o dia por fuso). */
export const dataBrasilia = (iso: string) => new Date(`${iso}T12:00:00-03:00`);

export function preencherDescricao(modelo: string, competenciaIso: string): string {
  const ano = competenciaIso.slice(0, 4);
  const mes = MESES[Number(competenciaIso.slice(5, 7)) - 1];
  return modelo
    .replaceAll('{mesAno}', `${mes}/${ano}`)
    .replaceAll('{mes}', mes)
    .replaceAll('{ano}', ano);
}

export interface DadosNota {
  /** Leiaute da DPS (ver src/leiaute.ts) — tem que ser o mesmo do NfseClient. */
  layout: Layout;
  empresa: Empresa;
  cliente: Cliente;
  nDPS: string;
  producao: boolean;
  valorMoeda: number;
  cotacao: Cotacao;
  /** AAAA-MM-DD */
  competencia: string;
  descricao: string;
}

export interface NotaMontada {
  dps: DPS;
  idDps: string;
  valorReais: number;
  infoComplementar: string;
}

/**
 * Monta a DPS de uma exportação de serviço feita por ME/EPP do Simples Nacional,
 * com o prestador no Brasil e o tomador no exterior.
 *
 * Regras do Anexo I (Sefin Nacional) que guiam os campos:
 *  - tribISSQN = 3 (exportação) → sem pAliq (E0602), sem retenção (E0580),
 *    regEspTrib = 0 (E0172) e cPaisResult obrigatório (E0590).
 *  - tomador no exterior → grupo comExt (E0330) e cNBS (E0318) obrigatórios;
 *    NIF ou cNaoNIF (E0223); cNaoNIF nunca "0" (E0226).
 *  - ME/EPP → regApTribSN obrigatório (E0166) e totTrib = pTotTribSN.
 *  - tpEmit = 1 → nome/endereço do prestador NÃO vão na DPS (vêm do CNPJ).
 */
export function montarDps(d: DadosNota): NotaMontada {
  const { empresa, cliente } = d;
  const valorReais = arred2(d.valorMoeda * d.cotacao.valor);
  if (valorReais <= 0) throw new Error('O valor da nota em reais precisa ser maior que zero.');

  const idDps = buildDpsId({
    cLocEmi: empresa.codigoMunicipio,
    tipoInsc: 'CNPJ',
    inscricaoFederal: empresa.cnpj,
    serie: empresa.serie,
    nDPS: d.nDPS,
  });

  const e = cliente.endereco;
  const toma: InfoPessoaNt004 = {
    identificador: cliente.nif ? { NIF: cliente.nif } : { cNaoNIF: CodigoNaoNif.NaoExigido },
    xNome: latin1(cliente.nome),
    end: {
      localidade: {
        endExt: {
          cPais: e.pais,
          cEndPost: latin1(e.codigoPostal),
          xCidade: latin1(e.cidade),
          xEstProvReg: latin1(e.estado),
        },
      },
      xLgr: latin1(e.logradouro),
      nro: latin1(e.numero),
      ...(latin1(e.complemento ?? '') ? { xCpl: latin1(e.complemento ?? '') } : {}),
      xBairro: latin1(e.bairro),
    },
    ...(cliente.email ? { email: cliente.email } : {}),
  };

  const taxa = d.cotacao.valor.toLocaleString('pt-BR', { minimumFractionDigits: 4 });
  const conversao = d.cotacao.fonte.startsWith('PTAX')
    ? `Conversão pela ${d.cotacao.fonte.replace(' (Banco Central)', '')} de ${dataBr(d.cotacao.data)} (${taxa})`
    : `Conversão pela cotação de ${taxa}`;
  const infoComplementar = latin1(
    `Valor do serviço: ${valorTexto(d.valorMoeda, cliente.moeda)}. ${conversao} = ${valorTexto(valorReais, 'BRL')}.`,
  );

  const ce = cliente.comercioExterior;

  // Campos comuns aos dois leiautes. Na NT 009 a única diferença que nos afeta é
  // `finNFSe` (finalidade: 0 = NFS-e regular) logo depois de tpEmit.
  const infDPS = {
      Id: idDps,
      tpAmb: d.producao ? TipoAmbienteDps.Producao : TipoAmbienteDps.Homologacao,
      // 1 min de folga: a Receita rejeita dhEmi "no futuro" (E0008) se o relógio estiver adiantado.
      dhEmi: new Date(Date.now() - 60_000),
      verAplic: VERSAO_APP,
      serie: empresa.serie,
      nDPS: d.nDPS,
      dCompet: dataBrasilia(d.competencia),
      tpEmit: TipoEmitenteDps.Prestador,
      cLocEmi: empresa.codigoMunicipio,
      prest: {
        identificador: { CNPJ: empresa.cnpj },
        ...(empresa.inscricaoMunicipal ? { IM: empresa.inscricaoMunicipal } : {}),
        regTrib: {
          opSimpNac: OpcaoSimplesNacional.MeEpp,
          regApTribSN: RegimeApuracaoSimplesNacional.FederalEMunicipalPeloSN,
          regEspTrib: RegimeEspecialTributacao.Nenhum,
        },
      },
      toma,
      serv: {
        // Serviço feito do Brasil (seu município); o resultado acontece no exterior.
        locPrest: { cLocPrestacao: empresa.codigoMunicipio },
        cServ: {
          cTribNac: cliente.servico.codigoTributacaoNacional,
          ...(cliente.servico.codigoTributacaoMunicipal
            ? { cTribMun: cliente.servico.codigoTributacaoMunicipal }
            : {}),
          xDescServ: d.descricao,
          cNBS: cliente.servico.codigoNBS,
        },
        comExt: {
          mdPrestacao: ce.modoPrestacao as ModoPrestacao,
          vincPrest: ce.vinculo as VinculoPrestacao,
          tpMoeda: cliente.codigoMoedaBacen,
          vServMoeda: arred2(d.valorMoeda),
          mecAFComexP: ce.mecanismoApoioPrestador as MecanismoApoioComExPrestador,
          mecAFComexT: ce.mecanismoApoioTomador as MecanismoApoioComExTomador,
          movTempBens: MovimentacaoTemporariaBens.Nao,
          mdic: ce.enviarMDIC as EnvioMDIC,
        },
        infoCompl: { xInfComp: infoComplementar },
      },
      valores: {
        vServPrest: { vServ: valorReais },
        trib: {
          tribMun: {
            tribISSQN: TipoTribISSQN.ExportacaoServico,
            cPaisResult: cliente.paisResultado,
            tpRetISSQN: TipoRetISSQN.NaoRetido,
          },
          totTrib: { pTotTribSN: arred2(empresa.aliquotaSimplesAproximada) },
        },
      },
  };

  let dps: DPS;
  switch (d.layout) {
    case 'nt004':
      dps = { layout: 'nt004', versao: '1.01', infDPS };
      break;
    case 'nt009':
      // O serializer da lib escreve os campos na ordem do XSD.
      dps = { layout: 'nt009', versao: '1.01', infDPS: { ...infDPS, finNFSe: FinalidadeNFSe.Regular } };
      break;
    default:
      throw new Error(`Leiaute desconhecido: ${String(d.layout)}`);
  }

  return { dps, idDps, valorReais, infoComplementar };
}
