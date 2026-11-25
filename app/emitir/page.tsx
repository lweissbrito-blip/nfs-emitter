import Link from 'next/link';
import { exigirLogin } from '../../web/auth';
import { listarClientesBrutos } from '../../web/config';
import { hojeBrasilia } from '../../src/cotacao';
import { EmitirForm } from './EmitirForm';

export const dynamic = 'force-dynamic';

export default async function Emitir() {
  await exigirLogin();
  const clientes = await listarClientesBrutos();
  if (!clientes.length) {
    return (
      <>
        <h1>Emitir nota</h1>
        <p>
          Cadastre um cliente primeiro em <Link href="/configuracao">Configuração</Link>.
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Emitir nota</h1>
      <EmitirForm
        clientes={clientes.map((c) => ({ apelido: c.apelido, nome: String(c.dados.nome ?? c.apelido), moeda: String(c.dados.moeda ?? 'USD') }))}
        hoje={hojeBrasilia()}
      />
    </>
  );
}
