'use client';
import Link from 'next/link';
import { startTransition, useActionState, useState, useTransition, type FormEvent } from 'react';
import type { Resultado } from '../../web/emissao';
import { acaoEmitir, acaoPrevia, acaoVerificarPendente } from '../acoes';
import { Mensagem } from '../Mensagem';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (n: number, c: string) => n.toLocaleString('pt-BR', { style: 'currency', currency: c });
const dataBr = (iso: string) => iso.split('-').reverse().join('/');

export function EmitirForm({ clientes, hoje }: { clientes: { apelido: string; nome: string; moeda: string }[]; hoje: string }) {
  const [estado, despachar, preparando] = useActionState(acaoPrevia, null);
  const [confirmacao, setConfirmacao] = useState('');
  const [resultado, setResultado] = useState<Resultado>();
  const [enviando, iniciar] = useTransition();
  const p = estado?.previa;
  const gerarPrevia = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); // sem reset automático do formulário (ver Formulario.tsx)
    const dados = new FormData(e.currentTarget);
    setResultado(undefined);
    setConfirmacao('');
    startTransition(() => despachar(dados));
  };
  const producao = p?.pedido.producao ?? false;

  const enviar = () =>
    iniciar(async () => {
      setResultado(await acaoEmitir(p!.pedido, p!.cotacao, confirmacao));
    });
  const verificarPendente = () =>
    iniciar(async () => {
      setResultado(await acaoVerificarPendente(producao));
    });

  if (resultado && (resultado.tipo === 'emitida' || resultado.tipo === 'pendente-resolvida')) {
    const n = resultado.nota;
    return (
      <div className="cartao">
        <Mensagem
          tipo="ok"
          texto={
            resultado.tipo === 'pendente-resolvida'
              ? 'A emissão que tinha ficado sem confirmação FOI gerada. Nada novo foi enviado — se precisa de outra nota, emita de novo.'
              : n.producao
                ? 'Nota fiscal emitida!'
                : 'Nota de TESTE autorizada (sem valor fiscal).'
          }
          detalhes={resultado.tipo === 'emitida' ? resultado.alertas.map((a) => `Receita: ${a}`) : undefined}
        />
        <dl className="resumo">
          <dt>Número</dt>
          <dd>{n.numero}</dd>
          <dt>Chave</dt>
          <dd>
            <code>{n.chave}</code>
          </dd>
          <dt>Tomador</dt>
          <dd>{n.tomador}</dd>
          <dt>Valor</dt>
          <dd>{brl(n.valorReais)}</dd>
        </dl>
        <Link className="botao" href={`/notas?ambiente=${n.producao ? 'producao' : 'testes'}`}>
          Ver notas (XML e PDF)
        </Link>{' '}
        <a className="botao secundario" href="/emitir">
          Emitir outra
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="cartao">
        <form onSubmit={gerarPrevia}>
          <div className="grade">
            <div>
              <label htmlFor="apelido">Cliente</label>
              <select id="apelido" name="apelido" defaultValue={p?.pedido.apelido}>
                {clientes.map((c) => (
                  <option key={c.apelido} value={c.apelido}>
                    {c.nome} ({c.moeda})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="valor">
                Valor da invoice<div className="ajuda">Na moeda do cliente. Aceita 2500, 2500.50 ou 2.500,50</div>
              </label>
              <input id="valor" name="valor" inputMode="decimal" required defaultValue={p?.pedido.valorMoeda} />
            </div>
            <div>
              <label htmlFor="competencia">
                Competência<div className="ajuda">Data do serviço (não pode ser futura)</div>
              </label>
              <input id="competencia" name="competencia" type="date" max={hoje} defaultValue={p?.pedido.competencia ?? hoje} required />
            </div>
            <div>
              <label htmlFor="ambiente">
                Ambiente<div className="ajuda">Testes não tem valor fiscal. Comece por ele.</div>
              </label>
              <select id="ambiente" name="ambiente" defaultValue={producao ? 'producao' : 'testes'}>
                <option value="testes">Testes (sem valor fiscal)</option>
                <option value="producao">PRODUÇÃO (nota real)</option>
              </select>
            </div>
          </div>
          <details>
            <summary>Opções</summary>
            <label htmlFor="cotacao">
              Cotação manual<div className="ajuda">Vazio = PTAX do Banco Central do dia útil anterior</div>
            </label>
            <input id="cotacao" name="cotacao" inputMode="decimal" />
            <label htmlFor="descricao">
              Descrição só desta nota<div className="ajuda">Vazio = descrição padrão do cliente. Variáveis: {'{mes} {ano} {mesAno}'}</div>
            </label>
            <textarea id="descricao" name="descricao" />
          </details>
          <button type="submit" disabled={preparando || enviando}>
            {preparando ? 'Validando…' : 'Gerar prévia'}
          </button>
          <p className="pequeno">A prévia monta a nota, valida no schema oficial e assina. Nada é enviado.</p>
        </form>
        {estado?.erro && <Mensagem tipo="erro" texto={estado.erro} detalhes={estado.detalhes} />}
      </div>

      {p && (
        <div className="cartao">
          <h2 style={{ marginTop: 0 }}>Confira antes de enviar</h2>
          {p.pendente && (
            <Mensagem
              tipo="aviso"
              texto={`Há uma emissão sem confirmação (DPS nº ${p.pendente.nDPS} para "${p.pendente.cliente}"). Ao enviar, o app primeiro pergunta à Receita se ela virou nota.`}
            />
          )}
          <dl className="resumo">
            <dt>Ambiente</dt>
            <dd className={producao ? 'producao' : undefined}>{producao ? 'PRODUÇÃO — nota fiscal real' : 'Testes (sem valor fiscal)'}</dd>
            <dt>Cliente</dt>
            <dd>{p.clienteNome}</dd>
            <dt>Competência</dt>
            <dd>{dataBr(p.pedido.competencia)}</dd>
            <dt>Valor</dt>
            <dd>{moeda(p.pedido.valorMoeda, p.moeda)}</dd>
            <dt>Cotação</dt>
            <dd>
              {p.cotacao.valor} — {p.cotacao.fonte}
              {p.cotacao.fonte.startsWith('PTAX') ? ` de ${dataBr(p.cotacao.data)}` : ''}
            </dd>
            <dt>Valor da nota</dt>
            <dd>
              <strong>{brl(p.valorReais)}</strong>
            </dd>
            <dt>Tributação</dt>
            <dd>Exportação de serviço (sem ISS), resultado em {p.paisResultado}</dd>
            <dt>Descrição</dt>
            <dd>{p.descricao}</dd>
            <dt>DPS</dt>
            <dd>
              série {p.serie}, nº {p.nDPS}
            </dd>
          </dl>
          {producao && (
            <>
              <label htmlFor="confirmacao">Isso gera uma nota fiscal REAL. Digite EMITIR para confirmar:</label>
              <input id="confirmacao" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoComplete="off" />
            </>
          )}
          <button
            className={producao ? 'perigo' : undefined}
            disabled={enviando || (producao && confirmacao !== 'EMITIR')}
            onClick={enviar}
          >
            {enviando ? 'Enviando para a Receita…' : producao ? 'Emitir nota real' : 'Enviar para o ambiente de testes'}
          </button>
          {resultado?.tipo === 'erro' && <Mensagem tipo="erro" texto={resultado.mensagem} detalhes={resultado.detalhes} />}
          {resultado?.tipo === 'info' && <Mensagem tipo="ok" texto={resultado.mensagem} />}
          {resultado?.tipo === 'incerto' && (
            <>
              <Mensagem tipo="aviso" texto={resultado.mensagem} />
              <button className="secundario" disabled={enviando} onClick={verificarPendente}>
                Verificar emissão pendente
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
