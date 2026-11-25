import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { sessaoValida } from '../web/auth';
import { acaoSair } from './acoes';
import './globals.css';

export const metadata: Metadata = { title: 'Emissor de NFS-e', robots: { index: false, follow: false } };

export default async function Layout({ children }: { children: ReactNode }) {
  const logado = await sessaoValida();
  return (
    <html lang="pt-BR">
      <body>
        <header>
          <div className="barra">
            <strong>Emissor de NFS-e</strong>
            {logado && (
              <>
                <Link href="/">Painel</Link>
                <Link href="/emitir">Emitir</Link>
                <Link href="/notas">Notas</Link>
                <Link href="/configuracao">Configuração</Link>
                <form action={acaoSair}>
                  <button type="submit">Sair</button>
                </form>
              </>
            )}
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
