/**
 * Definição dos campos dos formulários de empresa e cliente (nomes com ponto
 * viram objetos aninhados: "servico.codigoNBS" → { servico: { codigoNBS } }).
 * Os textos de ajuda vêm dos arquivos config/*.exemplo.json.
 */
export interface Campo {
  nome: string;
  rotulo: string;
  ajuda?: string;
  tipo?: 'texto' | 'numero' | 'area' | 'select';
  opcoes?: { valor: string; rotulo: string }[];
  obrigatorio?: boolean;
  padrao?: string;
  avancado?: boolean;
}

export const CAMPOS_EMPRESA: Campo[] = [
  { nome: 'cnpj', rotulo: 'CNPJ', obrigatorio: true, ajuda: 'Os 14 dígitos. Tem que ser o mesmo CNPJ do certificado.' },
  {
    nome: 'inscricaoMunicipal',
    rotulo: 'Inscrição Municipal',
    ajuda: "Só preencha se a prefeitura te deu uma. Se a Receita rejeitar com E0116, ela é obrigatória; com E0120, apague.",
  },
  {
    nome: 'codigoMunicipio',
    rotulo: 'Código IBGE do município',
    obrigatorio: true,
    padrao: '3523107',
    ajuda: 'Código IBGE (7 dígitos) do município do endereço do CNPJ. Itaquaquecetuba = 3523107.',
  },
  {
    nome: 'serie',
    rotulo: 'Série da DPS',
    obrigatorio: true,
    padrao: '1',
    ajuda: "Entre 1 e 49999 (faixa de 'aplicativo próprio'). O emissor web da Receita usa 70000+, então não há conflito. Se você já emitiu pela linha de comando nesta série, a numeração continua sozinha (o app avança ao receber E0014).",
  },
  {
    nome: 'aliquotaSimplesAproximada',
    rotulo: 'Alíquota aproximada do Simples (%)',
    tipo: 'numero',
    obrigatorio: true,
    ajuda: 'Ex.: 6 para 6%. Peça ao contador.',
  },
  {
    nome: 'servico.codigoTributacaoNacional',
    rotulo: 'Código de tributação nacional',
    obrigatorio: true,
    ajuda: '6 dígitos. Está no PDF/XML de uma nota já emitida pelo site, ou peça ao contador.',
  },
  { nome: 'servico.codigoNBS', rotulo: 'Código NBS', obrigatorio: true, ajuda: '9 dígitos. Obrigatório na exportação.' },
  { nome: 'servico.codigoTributacaoMunicipal', rotulo: 'Código de tributação municipal', ajuda: 'Opcional.', avancado: true },
  {
    nome: 'cotacao.tipo',
    rotulo: 'PTAX usada na conversão',
    tipo: 'select',
    padrao: 'venda',
    opcoes: [
      { valor: 'venda', rotulo: 'Venda (padrão)' },
      { valor: 'compra', rotulo: 'Compra' },
    ],
    ajuda: 'PTAX do Banco Central do dia útil anterior à emissão. Confirme o critério com o contador.',
  },
];

export const CAMPOS_CLIENTE: Campo[] = [
  { nome: 'nome', rotulo: 'Razão social', obrigatorio: true },
  {
    nome: 'nif',
    rotulo: 'Tax ID (NIF)',
    ajuda: "Tax ID do cliente no país dele (nos EUA, o EIN). Se não tiver, deixe vazio e o app informa 'NIF não exigido'.",
  },
  { nome: 'email', rotulo: 'E-mail' },
  { nome: 'endereco.pais', rotulo: 'País (sigla)', obrigatorio: true, padrao: 'US', ajuda: 'ISO de 2 letras, ex.: US.' },
  { nome: 'endereco.logradouro', rotulo: 'Rua / Street', obrigatorio: true },
  { nome: 'endereco.numero', rotulo: 'Número', obrigatorio: true },
  { nome: 'endereco.complemento', rotulo: 'Complemento (suite, apto)' },
  {
    nome: 'endereco.bairro',
    rotulo: 'Bairro',
    obrigatorio: true,
    ajuda: "Obrigatório no leiaute. Endereços dos EUA não têm bairro: use o nome da cidade ou 'Downtown'.",
  },
  { nome: 'endereco.cidade', rotulo: 'Cidade', obrigatorio: true },
  { nome: 'endereco.estado', rotulo: 'Estado / província', obrigatorio: true, ajuda: 'Ex.: FL' },
  { nome: 'endereco.codigoPostal', rotulo: 'Código postal (ZIP)', obrigatorio: true, ajuda: 'Ex.: 33101' },
  {
    nome: 'moeda',
    rotulo: 'Moeda da invoice',
    tipo: 'select',
    padrao: 'USD',
    opcoes: [
      { valor: 'USD', rotulo: 'USD — dólar americano' },
      { valor: 'EUR', rotulo: 'EUR — euro' },
    ],
  },
  {
    nome: 'paisResultado',
    rotulo: 'País do resultado do serviço',
    ajuda: 'Onde o resultado do serviço acontece (sigla de 2 letras). É o que caracteriza a exportação. Vazio = país do endereço.',
  },
  {
    nome: 'descricao',
    rotulo: 'Descrição padrão da nota',
    tipo: 'area',
    obrigatorio: true,
    padrao: 'Serviços de design de interface (UX/UI) referentes a {mesAno}.',
    ajuda: 'Variáveis: {mes} {ano} {mesAno}. Dá para trocar na hora de emitir.',
  },
  {
    nome: 'servico.codigoTributacaoNacional',
    rotulo: 'Código de tributação nacional (só deste cliente)',
    ajuda: 'Vazio = usa o da empresa.',
    avancado: true,
  },
  { nome: 'servico.codigoNBS', rotulo: 'Código NBS (só deste cliente)', ajuda: 'Vazio = usa o da empresa.', avancado: true },
  {
    nome: 'comercioExterior.modoPrestacao',
    rotulo: 'Modo de prestação',
    padrao: '1',
    ajuda: '1 = transfronteiriço (você no Brasil, cliente lá fora). Só mude se o contador pedir.',
    avancado: true,
  },
  { nome: 'comercioExterior.vinculo', rotulo: 'Vínculo entre as partes', padrao: '0', ajuda: '0 = sem vínculo.', avancado: true },
  { nome: 'comercioExterior.mecanismoApoioPrestador', rotulo: 'Mecanismo de apoio (prestador)', padrao: '01', ajuda: '01 = nenhum.', avancado: true },
  { nome: 'comercioExterior.mecanismoApoioTomador', rotulo: 'Mecanismo de apoio (tomador)', padrao: '01', ajuda: '01 = nenhum.', avancado: true },
  { nome: 'comercioExterior.enviarMDIC', rotulo: 'Compartilhar com a Secex/MDIC', padrao: '0', ajuda: '0 = não.', avancado: true },
];

/** FormData → objeto aninhado, só com os campos conhecidos. */
export function lerFormulario(form: FormData, campos: Campo[]): Record<string, unknown> {
  const raiz: Record<string, unknown> = {};
  for (const c of campos) {
    const bruto = String(form.get(c.nome) ?? '').trim();
    const valor = c.tipo === 'numero' ? (bruto === '' ? '' : Number(bruto.replace(',', '.'))) : bruto;
    const partes = c.nome.split('.');
    let alvo = raiz;
    for (const p of partes.slice(0, -1)) alvo = (alvo[p] ??= {}) as Record<string, unknown>;
    alvo[partes.at(-1)!] = valor;
  }
  return raiz;
}

/** Objeto aninhado → valor de um campo para preencher o formulário. */
export function valorDe(obj: Record<string, unknown> | undefined, nome: string): string {
  let atual: unknown = obj;
  for (const p of nome.split('.')) {
    if (atual && typeof atual === 'object') atual = (atual as Record<string, unknown>)[p];
    else return '';
  }
  return atual === undefined || atual === null ? '' : String(atual);
}
