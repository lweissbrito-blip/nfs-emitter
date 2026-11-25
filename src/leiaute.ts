/**
 * Qual leiaute da DPS usar. A NT 009/2026 mudou o XML (ex.: `finNFSe` na raiz):
 *  - Produção Restrita (testes): NT 009 desde 20/10/2026;
 *  - Produção: NT 004 até 30/11/2026, NT 009 a partir de 01/12/2026.
 *
 * Se a Receita adiar a virada, dá para forçar o leiaute de produção com a
 * variável de ambiente NFSE_LEIAUTE_PRODUCAO=nt004 (ou nt009).
 */
import { LAYOUTS, type Layout } from 'open-nfse';
import { hojeBrasilia } from './cotacao';

export const VIRADA_NT009_PRODUCAO = '2026-12-01';

export function leiauteDe(producao: boolean, dataIso: string = hojeBrasilia()): Layout {
  if (!producao) return 'nt009';
  const forcado = process.env.NFSE_LEIAUTE_PRODUCAO?.trim();
  if (forcado) {
    if (!(LAYOUTS as readonly string[]).includes(forcado)) {
      throw new Error(`NFSE_LEIAUTE_PRODUCAO inválido: "${forcado}" (use ${LAYOUTS.join(' ou ')}).`);
    }
    return forcado as Layout;
  }
  return dataIso >= VIRADA_NT009_PRODUCAO ? 'nt009' : 'nt004';
}
