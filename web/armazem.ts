/**
 * Equivalente web de src/estado.ts. A trava contra nota duplicada é o campo
 * `pendente`: ele só é gravado se estiver vazio E o número ainda for o próximo
 * (compare-and-set atômico no Postgres). Enquanto houver pendente, nenhuma DPS
 * nova é enviada.
 */
import type { Pendente } from '../src/estado';
import { sql } from './db';

export type { Pendente };

export type NomeAmbiente = 'producao' | 'testes';
export const nomeAmb = (producao: boolean): NomeAmbiente => (producao ? 'producao' : 'testes');

async function garantirLinha(amb: NomeAmbiente) {
  await sql(`insert into estado (ambiente) values ($1) on conflict do nothing`, [amb]);
}

export async function proximoNumero(amb: NomeAmbiente, serie: string): Promise<string> {
  await garantirLinha(amb);
  const [r] = await sql<{ n: number }>(
    `select coalesce((ultimo_numero->>$2)::int, 0) + 1 as n from estado where ambiente = $1`,
    [amb, serie],
  );
  return String(r.n);
}

export async function pendente(amb: NomeAmbiente): Promise<Pendente | null> {
  await garantirLinha(amb);
  const [r] = await sql<{ pendente: Pendente | null }>(`select pendente from estado where ambiente = $1`, [amb]);
  return r.pendente;
}

/** Grava o pendente só se não houver outro e se `p.nDPS` ainda for o próximo número. */
export async function reservar(amb: NomeAmbiente, p: Pendente): Promise<boolean> {
  await garantirLinha(amb);
  const r = await sql(
    `update estado set pendente = $2
      where ambiente = $1 and pendente is null
        and coalesce((ultimo_numero->>$3)::int, 0) + 1 = $4::int
      returning 1`,
    [amb, JSON.stringify(p), p.serie, Number(p.nDPS)],
  );
  return r.length === 1;
}

/** Limpa o pendente, desde que seja o mesmo (não apaga a tentativa de outra requisição). */
export async function liberar(amb: NomeAmbiente, idDps: string) {
  await sql(`update estado set pendente = null where ambiente = $1 and pendente->>'idDps' = $2`, [amb, idDps]);
}

/** Marca um número como consumido (só avança, nunca volta). */
export async function confirmarNumero(amb: NomeAmbiente, serie: string, nDPS: string) {
  await garantirLinha(amb);
  await sql(
    `update estado set ultimo_numero = jsonb_set(
        ultimo_numero, array[$2::text],
        to_jsonb(greatest(coalesce((ultimo_numero->>$2)::int, 0), $3::int)))
      where ambiente = $1`,
    [amb, serie, Number(nDPS)],
  );
}

export interface LinhaNota {
  id: number;
  ambiente: NomeAmbiente;
  chave: string;
  numero_nfse: string | null;
  n_dps: string | null;
  serie: string | null;
  cliente: string | null;
  tomador: string | null;
  competencia: string | null;
  valor_moeda: string | null;
  moeda: string | null;
  cotacao: string | null;
  valor_reais: string | null;
  emitida_em: Date;
  cancelada_em: Date | null;
}

export async function registrarNota(n: {
  ambiente: NomeAmbiente;
  chave: string;
  numeroNfse: string;
  nDPS: string;
  serie: string;
  cliente: string | null;
  tomador: string | null;
  competencia: string;
  valorMoeda: number | null;
  moeda: string | null;
  cotacao: number | null;
  valorReais: number;
  xml: string;
}) {
  await sql(
    `insert into notas (ambiente, chave, numero_nfse, n_dps, serie, cliente, tomador, competencia,
                        valor_moeda, moeda, cotacao, valor_reais, xml)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (chave) do update set xml = excluded.xml,
       cliente = coalesce(notas.cliente, excluded.cliente),
       valor_moeda = coalesce(notas.valor_moeda, excluded.valor_moeda),
       moeda = coalesce(notas.moeda, excluded.moeda),
       cotacao = coalesce(notas.cotacao, excluded.cotacao)`,
    [
      n.ambiente, n.chave, n.numeroNfse, n.nDPS, n.serie, n.cliente, n.tomador, n.competencia,
      n.valorMoeda, n.moeda, n.cotacao, n.valorReais, n.xml,
    ],
  );
}

const COLUNAS = `id, ambiente, chave, numero_nfse, n_dps, serie, cliente, tomador,
  to_char(competencia, 'YYYY-MM-DD') as competencia, valor_moeda, moeda, cotacao, valor_reais,
  emitida_em, cancelada_em`;

export async function listarNotas(amb: NomeAmbiente): Promise<LinhaNota[]> {
  return sql<LinhaNota>(`select ${COLUNAS} from notas where ambiente = $1 order by emitida_em desc limit 500`, [amb]);
}

export async function buscarNota(id: number): Promise<(LinhaNota & { xml: string; xml_cancelamento: string | null }) | undefined> {
  const [r] = await sql<LinhaNota & { xml: string; xml_cancelamento: string | null }>(
    `select ${COLUNAS}, xml, xml_cancelamento from notas where id = $1`,
    [id],
  );
  return r;
}

export async function marcarCancelada(chave: string, xmlEvento: string) {
  await sql(`update notas set cancelada_em = now(), xml_cancelamento = $2 where chave = $1`, [chave, xmlEvento]);
}
