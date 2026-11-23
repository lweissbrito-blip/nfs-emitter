/**
 * Validação da configuração (empresa e clientes), sem acesso a disco: usada pela
 * linha de comando (arquivos JSON em config/) e pelo app web (banco de dados).
 */
import { validateCnpj } from 'open-nfse';

export class ErroConfig extends Error {
  constructor(
    public readonly arquivo: string,
    public readonly problemas: string[],
  ) {
    super(`Problemas em ${arquivo}:\n${problemas.map((p) => `  • ${p}`).join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// Tipos

export interface Empresa {
  cnpj: string;
  inscricaoMunicipal?: string;
  codigoMunicipio: string;
  serie: string;
  aliquotaSimplesAproximada: number;
  servico: Servico;
  cotacao: { tipo: 'venda' | 'compra' };
}

export interface Servico {
  codigoTributacaoNacional: string;
  codigoNBS: string;
  codigoTributacaoMunicipal?: string;
}

export interface Cliente {
  apelido: string;
  nome: string;
  nif?: string;
  email?: string;
  endereco: {
    pais: string;
    logradouro: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    estado: string;
    codigoPostal: string;
  };
  moeda: string;
  codigoMoedaBacen: string;
  paisResultado: string;
  descricao: string;
  servico: Servico;
  comercioExterior: {
    modoPrestacao: string;
    vinculo: string;
    mecanismoApoioPrestador: string;
    mecanismoApoioTomador: string;
    enviarMDIC: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers

/** Códigos de moeda da tabela do Banco Central (o leiaute pede BACEN, não ISO). */
export const MOEDAS_BACEN: Record<string, string> = { USD: '220', EUR: '978' };

const ehPlaceholder = (v: unknown): boolean =>
  typeof v === 'string' && (v.includes('PREENCHER') || /^0+$/.test(v));

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const soDigitos = (v: unknown): string => texto(v).replace(/\D/g, '');

function validarServico(s: Servico, prob: string[], prefixo = 'servico') {
  if (!/^\d{6}$/.test(s.codigoTributacaoNacional) || ehPlaceholder(s.codigoTributacaoNacional)) {
    prob.push(`${prefixo}.codigoTributacaoNacional: precisa de 6 dígitos reais (ex.: 010101)`);
  }
  if (!/^\d{9}$/.test(s.codigoNBS) || ehPlaceholder(s.codigoNBS)) {
    prob.push(`${prefixo}.codigoNBS: precisa de 9 dígitos reais (obrigatório em exportação)`);
  }
}

// ---------------------------------------------------------------------------
// Validação

export function validarEmpresa(j: Record<string, unknown>, origem = 'config/empresa.json'): Empresa {
  const prob: string[] = [];

  const cnpj = soDigitos(j.cnpj);
  if (cnpj.length !== 14 || ehPlaceholder(cnpj)) {
    prob.push('cnpj: informe os 14 dígitos do CNPJ');
  } else {
    try {
      validateCnpj(cnpj);
    } catch {
      prob.push('cnpj: dígito verificador não confere — confira o número');
    }
  }

  const codigoMunicipio = soDigitos(j.codigoMunicipio);
  if (codigoMunicipio.length !== 7) prob.push('codigoMunicipio: código IBGE tem 7 dígitos');

  const serie = String(j.serie ?? '1').trim();
  const nSerie = Number(serie);
  if (!/^\d{1,5}$/.test(serie) || nSerie < 1 || nSerie > 49999) {
    prob.push('serie: use um número entre 1 e 49999 (faixa de aplicativo próprio)');
  }

  const aliq = Number(j.aliquotaSimplesAproximada);
  if (!Number.isFinite(aliq) || aliq <= 0 || aliq >= 100) {
    prob.push('aliquotaSimplesAproximada: informe o percentual (ex.: 6 para 6%) — peça ao contador');
  }

  const s = (j.servico ?? {}) as Record<string, unknown>;
  const servico: Servico = {
    codigoTributacaoNacional: soDigitos(s.codigoTributacaoNacional),
    codigoNBS: soDigitos(s.codigoNBS),
    ...(texto(s.codigoTributacaoMunicipal)
      ? { codigoTributacaoMunicipal: texto(s.codigoTributacaoMunicipal) }
      : {}),
  };
  validarServico(servico, prob);

  const tipoCotacao = texto((j.cotacao as Record<string, unknown> | undefined)?.tipo) || 'venda';
  if (tipoCotacao !== 'venda' && tipoCotacao !== 'compra') {
    prob.push("cotacao.tipo: use 'venda' ou 'compra'");
  }

  if (prob.length) throw new ErroConfig(origem, prob);

  const im = soDigitos(j.inscricaoMunicipal);
  return {
    cnpj,
    ...(im ? { inscricaoMunicipal: im } : {}),
    codigoMunicipio,
    serie: String(nSerie),
    aliquotaSimplesAproximada: aliq,
    servico,
    cotacao: { tipo: tipoCotacao as 'venda' | 'compra' },
  };
}

export function validarApelido(apelido: string) {
  if (!/^[a-z0-9_-]+$/i.test(apelido)) {
    throw new ErroConfig('cliente', [`apelido inválido: "${apelido}" (use letras, números, - ou _)`]);
  }
}

export function validarCliente(
  apelido: string,
  j: Record<string, unknown>,
  empresa: Empresa,
  origem = `config/clientes/${apelido}.json`,
): Cliente {
  validarApelido(apelido);
  const prob: string[] = [];

  const nome = texto(j.nome);
  if (!nome || ehPlaceholder(nome)) prob.push('nome: razão social do cliente');
  if (nome.length > 300) prob.push('nome: máximo de 300 caracteres');

  const e = (j.endereco ?? {}) as Record<string, unknown>;
  const endereco = {
    pais: texto(e.pais).toUpperCase(),
    logradouro: texto(e.logradouro),
    numero: texto(e.numero),
    complemento: texto(e.complemento),
    bairro: texto(e.bairro),
    cidade: texto(e.cidade),
    estado: texto(e.estado),
    codigoPostal: texto(e.codigoPostal),
  };
  if (!/^[A-Z]{2}$/.test(endereco.pais) || endereco.pais === 'BR') {
    prob.push('endereco.pais: sigla ISO de 2 letras de um país estrangeiro (ex.: US)');
  }
  const limites: [keyof typeof endereco, number][] = [
    ['logradouro', 255],
    ['numero', 60],
    ['bairro', 60],
    ['cidade', 60],
    ['estado', 60],
    ['codigoPostal', 11],
  ];
  for (const [campo, max] of limites) {
    const v = endereco[campo];
    if (!v || ehPlaceholder(v)) prob.push(`endereco.${campo}: obrigatório`);
    else if (v.length > max) prob.push(`endereco.${campo}: máximo de ${max} caracteres`);
  }
  if (endereco.complemento.length > 156) prob.push('endereco.complemento: máximo de 156 caracteres');

  const nif = texto(j.nif);
  if (nif.length > 40) prob.push('nif: máximo de 40 caracteres');

  const email = texto(j.email);
  if (email && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 80)) {
    prob.push('email: formato inválido (máximo de 80 caracteres)');
  }

  const moeda = (texto(j.moeda) || 'USD').toUpperCase();
  const codigoMoedaBacen = texto(j.codigoMoedaBacen) || MOEDAS_BACEN[moeda] || '';
  if (!/^\d{3}$/.test(codigoMoedaBacen)) {
    prob.push(`moeda: ${moeda} não está mapeada — informe "codigoMoedaBacen" (tabela do Banco Central)`);
  }

  const paisResultado = (texto(j.paisResultado) || endereco.pais).toUpperCase();
  if (!/^[A-Z]{2}$/.test(paisResultado) || paisResultado === 'BR') {
    prob.push('paisResultado: sigla de 2 letras de país estrangeiro');
  }

  const descricao = texto(j.descricao);
  if (!descricao) prob.push('descricao: texto padrão da nota');

  const sc = (j.servico ?? {}) as Record<string, unknown>;
  const servico: Servico = {
    codigoTributacaoNacional:
      soDigitos(sc.codigoTributacaoNacional) || empresa.servico.codigoTributacaoNacional,
    codigoNBS: soDigitos(sc.codigoNBS) || empresa.servico.codigoNBS,
    ...((texto(sc.codigoTributacaoMunicipal) || empresa.servico.codigoTributacaoMunicipal)
      ? {
          codigoTributacaoMunicipal:
            texto(sc.codigoTributacaoMunicipal) || empresa.servico.codigoTributacaoMunicipal,
        }
      : {}),
  };
  validarServico(servico, prob);

  const ce = (j.comercioExterior ?? {}) as Record<string, unknown>;
  const comercioExterior = {
    modoPrestacao: texto(ce.modoPrestacao) || '1',
    vinculo: texto(ce.vinculo) || '0',
    mecanismoApoioPrestador: texto(ce.mecanismoApoioPrestador) || '01',
    mecanismoApoioTomador: texto(ce.mecanismoApoioTomador) || '01',
    enviarMDIC: texto(ce.enviarMDIC) || '0',
  };
  if (!['1', '2', '3', '4'].includes(comercioExterior.modoPrestacao)) {
    prob.push('comercioExterior.modoPrestacao: 1, 2, 3 ou 4');
  }
  if (!['0', '1', '2', '3', '4', '5', '6'].includes(comercioExterior.vinculo)) {
    prob.push('comercioExterior.vinculo: 0 a 6');
  }
  if (!/^(0[1-8])$/.test(comercioExterior.mecanismoApoioPrestador)) {
    prob.push('comercioExterior.mecanismoApoioPrestador: 01 a 08');
  }
  if (!/^(0[1-9]|1\d|2[0-6])$/.test(comercioExterior.mecanismoApoioTomador)) {
    prob.push('comercioExterior.mecanismoApoioTomador: 01 a 26');
  }
  if (!['0', '1'].includes(comercioExterior.enviarMDIC)) {
    prob.push('comercioExterior.enviarMDIC: 0 ou 1');
  }

  if (prob.length) throw new ErroConfig(origem, prob);

  return {
    apelido,
    nome,
    ...(nif ? { nif } : {}),
    ...(email ? { email } : {}),
    endereco,
    moeda,
    codigoMoedaBacen,
    paisResultado,
    descricao,
    servico,
    comercioExterior,
  };
}
