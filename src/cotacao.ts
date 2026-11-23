/**
 * Cotação PTAX do Banco Central (API pública Olinda/PTAX).
 * Por padrão usa o dia útil anterior à data de emissão — feriados e fins de
 * semana são pulados automaticamente (a API devolve lista vazia nesses dias).
 */

const BASE = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata';

export interface Cotacao {
  moeda: string;
  tipo: 'venda' | 'compra';
  valor: number;
  /** Data da cotação, AAAA-MM-DD. */
  data: string;
  fonte: string;
}

interface RegistroPtax {
  cotacaoCompra: number;
  cotacaoVenda: number;
  dataHoraCotacao: string;
  tipoBoletim?: string;
}

/** Data de "hoje" no fuso de Brasília, AAAA-MM-DD (independe do fuso do computador). */
export function hojeBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function menosDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** AAAA-MM-DD → MM-DD-AAAA (formato que a API do BC pede). */
const paraFormatoBc = (iso: string) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;

async function buscarDia(moeda: string, iso: string): Promise<RegistroPtax | undefined> {
  const data = paraFormatoBc(iso);
  const url =
    moeda === 'USD'
      ? `${BASE}/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${data}'&$format=json`
      : `${BASE}/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?@moeda='${moeda}'&@dataCotacao='${data}'&$format=json`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`Banco Central respondeu HTTP ${resp.status}`);
  const corpo = (await resp.json()) as { value?: RegistroPtax[] };
  const lista = corpo.value ?? [];
  if (!lista.length) return undefined;
  // Para outras moedas vêm vários boletins no dia; o oficial é o "Fechamento PTAX".
  return lista.find((r) => r.tipoBoletim?.startsWith('Fechamento')) ?? lista[lista.length - 1];
}

/**
 * Busca a PTAX do último dia útil ANTERIOR a `dataEmissao` (AAAA-MM-DD).
 * Tenta até 10 dias para trás (cobre feriados emendados).
 */
export async function buscarPtax(
  moeda: string,
  tipo: 'venda' | 'compra',
  dataEmissao: string = hojeBrasilia(),
): Promise<Cotacao> {
  for (let i = 1; i <= 10; i++) {
    const dia = menosDias(dataEmissao, i);
    const reg = await buscarDia(moeda, dia);
    if (reg) {
      return {
        moeda,
        tipo,
        valor: tipo === 'venda' ? reg.cotacaoVenda : reg.cotacaoCompra,
        data: dia,
        fonte: `PTAX ${tipo} ${moeda} (Banco Central)`,
      };
    }
  }
  throw new Error(`Não encontrei PTAX de ${moeda} nos 10 dias antes de ${dataEmissao}.`);
}
