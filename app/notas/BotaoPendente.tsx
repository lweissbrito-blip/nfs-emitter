'use client';
import { useState, useTransition } from 'react';
import type { Resultado } from '../../web/emissao';
import { acaoVerificarPendente } from '../acoes';
import { Mensagem } from '../Mensagem';

export function BotaoPendente({ producao }: { producao: boolean }) {
  const [r, setR] = useState<Resultado>();
  const [ocupado, iniciar] = useTransition();
  return (
    <>
      <button className="secundario" disabled={ocupado} onClick={() => iniciar(async () => setR(await acaoVerificarPendente(producao)))}>
        {ocupado ? 'Consultando a Receita…' : 'Verificar emissão pendente'}
      </button>
      {r?.tipo === 'pendente-resolvida' && <Mensagem tipo="ok" texto={`A nota FOI emitida: nº ${r.nota.numero}. Salva na lista.`} />}
      {r?.tipo === 'info' && <Mensagem tipo="ok" texto={r.mensagem} />}
      {r?.tipo === 'erro' && <Mensagem tipo="erro" texto={r.mensagem} detalhes={r.detalhes} />}
    </>
  );
}
