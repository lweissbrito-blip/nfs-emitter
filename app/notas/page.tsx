import Link from 'next/link';
import { exigirLogin } from '../../web/auth';
import { listarNotas, pendente, type NomeAmbiente } from '../../web/armazem';
import { acaoCancelar, acaoImportar } from '../acoes';
import { Formulario } from '../Formulario';
import { Mensagem } from '../Mensagem';
import { BotaoPendente } from './BotaoPendente';

export const dynamic = 'force-dynamic';

const brl = (n: string | null) => (n === null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

export default async function Notas({ searchParams }: { searchParams: Promise<{ ambiente?: string }> }) {
  await exigirLogin();
  const amb: NomeAmbiente = (await searchParams).ambiente === 'producao' ? 'producao' : 'testes';
  const [notas, pend] = await Promise.all([listarNotas(amb), pendente(amb)]);
  const outro = amb === 'producao' ? 'testes' : 'producao';
  return (
    <>
      <h1>Notas — {amb === 'producao' ? 'produção' : 'testes'}</h1>
      <p>
        <Link href={`/notas?ambiente=${outro}`}>Ver {outro === 'producao' ? 'produção' : 'testes'}</Link> ·{' '}
        <a href={`/notas/csv/${amb}`}>Baixar planilha (CSV)</a>
      </p>
      {pend && (
        <div className="cartao">
          <Mensagem
            tipo="aviso"
            texto={`Emissão sem confirmação: DPS nº ${pend.nDPS} para "${pend.cliente}", iniciada em ${new Date(pend.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Nenhuma nota nova será enviada até isso ser resolvido.`}
          />
          <BotaoPendente producao={amb === 'producao'} />
        </div>
      )}
      {notas.length === 0 ? (
        <p>Nenhuma nota neste ambiente ainda.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nº</th>
              <th>Emitida</th>
              <th>Tomador</th>
              <th>Competência</th>
              <th>Valor</th>
              <th>Arquivos</th>
            </tr>
          </thead>
          <tbody>
            {notas.map((n) => (
              <tr key={n.id}>
                <td>
                  {n.numero_nfse}
                  {n.cancelada_em && <div className="producao">CANCELADA</div>}
                </td>
                <td>{n.emitida_em.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                <td>{n.tomador ?? n.cliente}</td>
                <td>{dataBr(n.competencia)}</td>
                <td>
                  {brl(n.valor_reais)}
                  {n.valor_moeda && n.moeda && (
                    <div className="pequeno">
                      {n.moeda} {Number(n.valor_moeda).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} × {n.cotacao}
                    </div>
                  )}
                </td>
                <td>
                  <a href={`/notas/${n.id}/pdf`}>PDF</a> · <a href={`/notas/${n.id}/xml`}>XML</a>
                  {n.cancelada_em && (
                    <>
                      {' '}
                      · <a href={`/notas/${n.id}/cancelamento`}>cancelamento</a>
                    </>
                  )}
                  {!n.cancelada_em && (
                    <details>
                      <summary>cancelar</summary>
                      <Formulario acao={acaoCancelar} botao="Cancelar nota" classeBotao="perigo">
                        <input type="hidden" name="id" value={n.id} />
                        <label>
                          Motivo<div className="ajuda">15 a 255 caracteres</div>
                          <input name="motivo" minLength={15} maxLength={255} required />
                        </label>
                        <label style={{ fontWeight: 400 }}>
                          <input type="checkbox" name="naoPrestado" style={{ width: 'auto' }} /> Serviço não prestado (padrão:
                          erro na emissão)
                        </label>
                        <label>
                          Digite CANCELAR
                          <input name="confirmacao" autoComplete="off" required />
                        </label>
                      </Formulario>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="cartao" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Buscar nota pela chave de acesso</h2>
        <p className="pequeno">Baixa da Receita e guarda aqui (ex.: notas emitidas pelo site ou pela linha de comando).</p>
        <Formulario acao={acaoImportar} botao="Buscar e salvar" classeBotao="secundario">
          <input type="hidden" name="ambiente" value={amb} />
          <label>
            Chave de acesso (50 dígitos)
            <input name="chave" required />
          </label>
        </Formulario>
      </div>
      <p className="pequeno">
        O XML é o documento fiscal oficial: guarde por pelo menos 5 anos. O PDF é gerado a partir dele quando você baixa.
      </p>
    </>
  );
}
