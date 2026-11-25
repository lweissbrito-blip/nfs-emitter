'use client';
import { useState, useTransition } from 'react';
import type { ItemVerificacao } from '../web/emissao';
import { acaoVerificar } from './acoes';
import { ListaVerificacao } from './ListaVerificacao';

export function TestarReceita() {
  const [itens, setItens] = useState<ItemVerificacao[]>();
  const [pendente, iniciar] = useTransition();
  const testar = (producao: boolean) =>
    iniciar(async () => {
      const r = await acaoVerificar({ producao });
      setItens(r.filter((i) => i.nome.startsWith('Conexão') || i.nome.startsWith('Convênio') || i.nome === 'Certificado'));
    });
  return (
    <>
      <button className="secundario" disabled={pendente} onClick={() => testar(false)}>
        Testar ambiente de testes
      </button>{' '}
      <button className="secundario" disabled={pendente} onClick={() => testar(true)}>
        Testar produção
      </button>
      {pendente && <p>Consultando a Receita…</p>}
      {itens && <ListaVerificacao itens={itens} />}
    </>
  );
}
