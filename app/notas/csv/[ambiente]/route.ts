import { sessaoValida } from '../../../../web/auth';
import { listarNotas } from '../../../../web/armazem';

export const runtime = 'nodejs';

const num = (n: string | null) => (n === null ? '' : n.replace('.', ','));
const celula = (s: string | null) => (s ?? '').replace(/[;\r\n]/g, ' ');

/** Mesmo formato do dados/<amb>/notas.csv da linha de comando (abre no Excel pt-BR). */
export async function GET(_: Request, { params }: { params: Promise<{ ambiente: string }> }) {
  if (!(await sessaoValida())) return new Response('Não autorizado', { status: 401 });
  const amb = (await params).ambiente === 'producao' ? 'producao' : 'testes';
  const notas = await listarNotas(amb);
  const linhas = [
    'data_emissao;numero_nfse;n_dps;cliente;tomador;competencia;valor_moeda;moeda;cotacao;valor_reais;chave_acesso;cancelada',
    ...notas.map((n) =>
      [
        n.emitida_em.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
        n.numero_nfse, n.n_dps, celula(n.cliente), celula(n.tomador), n.competencia,
        num(n.valor_moeda), n.moeda, num(n.cotacao), num(n.valor_reais), n.chave, n.cancelada_em ? 'sim' : '',
      ].join(';'),
    ),
  ];
  return new Response('﻿' + linhas.join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="notas_${amb}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}
