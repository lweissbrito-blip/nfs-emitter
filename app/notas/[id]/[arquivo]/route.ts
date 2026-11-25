import { sessaoValida } from '../../../../web/auth';
import { buscarNota } from '../../../../web/armazem';
import { pdfDaNota } from '../../../../web/emissao';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ id: string; arquivo: string }> }) {
  if (!(await sessaoValida())) return new Response('Não autorizado', { status: 401 });
  const { id, arquivo } = await params;
  const nota = /^\d+$/.test(id) ? await buscarNota(Number(id)) : undefined;
  if (!nota) return new Response('Nota não encontrada', { status: 404 });
  const base = `${(nota.competencia ?? '').slice(0, 7)}_${nota.cliente ?? 'nota'}_nfse-${nota.numero_nfse}`;
  const enviar = (corpo: BodyInit, tipo: string, nome: string) =>
    new Response(corpo, {
      headers: {
        'content-type': tipo,
        'content-disposition': `attachment; filename="${nome.replace(/[^\w.-]/g, '_')}"`,
        'cache-control': 'private, no-store',
      },
    });
  switch (arquivo) {
    case 'xml':
      return enviar(nota.xml, 'application/xml; charset=utf-8', `${base}.xml`);
    case 'pdf':
      return enviar(new Uint8Array(await pdfDaNota(nota.xml)), 'application/pdf', `${base}.pdf`);
    case 'cancelamento':
      if (!nota.xml_cancelamento) return new Response('Sem cancelamento', { status: 404 });
      return enviar(nota.xml_cancelamento, 'application/xml; charset=utf-8', `cancelamento_nfse-${nota.numero_nfse}.xml`);
    default:
      return new Response('Arquivo desconhecido', { status: 404 });
  }
}
