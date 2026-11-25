'use client';
import { startTransition, useActionState, type FormEvent, type ReactNode } from 'react';
import type { Estado } from './acoes';
import { Mensagem } from './Mensagem';

/** Formulário ligado a uma server action que devolve { ok | erro, detalhes }. */
export function Formulario({
  acao,
  children,
  botao,
  classeBotao,
}: {
  acao: (estado: Estado, form: FormData) => Promise<Estado>;
  children: ReactNode;
  botao: string;
  classeBotao?: string;
}) {
  const [estado, despachar, enviando] = useActionState(acao, null);
  // onSubmit em vez de action={...}: o React limpa o formulário depois de uma action,
  // e o usuário perderia o que digitou quando a validação falha.
  const enviar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    startTransition(() => despachar(dados));
  };
  return (
    <form onSubmit={enviar}>
      {children}
      {estado?.erro && <Mensagem tipo="erro" texto={estado.erro} detalhes={estado.detalhes} />}
      {estado?.ok && <Mensagem tipo="ok" texto={estado.ok} />}
      <button type="submit" disabled={enviando} className={classeBotao}>
        {enviando ? 'Aguarde…' : botao}
      </button>
    </form>
  );
}
