import { notFound } from 'next/navigation';
import { exigirLogin } from '../../../../web/auth';
import { CAMPOS_CLIENTE } from '../../../../web/campos';
import { lerClienteBruto } from '../../../../web/config';
import { acaoExcluirCliente, acaoSalvarCliente } from '../../../acoes';
import { CamposForm } from '../../../CamposForm';
import { Formulario } from '../../../Formulario';

export const dynamic = 'force-dynamic';

export default async function EditarCliente({ params }: { params: Promise<{ apelido: string }> }) {
  await exigirLogin();
  const { apelido } = await params;
  const novo = apelido === 'novo';
  const dados = novo ? undefined : await lerClienteBruto(apelido);
  if (!novo && !dados) notFound();
  return (
    <>
      <h1>{novo ? 'Novo cliente' : `Cliente "${apelido}"`}</h1>
      <div className="cartao">
        <Formulario acao={acaoSalvarCliente} botao="Salvar cliente">
          {novo ? (
            <label>
              Apelido *<div className="ajuda">Nome curto para escolher na hora de emitir (letras, números, - ou _).</div>
              <input name="apelido" required pattern="[A-Za-z0-9_\-]+" />
            </label>
          ) : (
            <input type="hidden" name="apelido" value={apelido} />
          )}
          <CamposForm campos={CAMPOS_CLIENTE} dados={dados} />
        </Formulario>
      </div>
      {!novo && (
        <form action={acaoExcluirCliente}>
          <input type="hidden" name="apelido" value={apelido} />
          <button className="perigo" type="submit">
            Excluir cliente
          </button>
          <p className="pequeno">As notas já emitidas para ele continuam na lista.</p>
        </form>
      )}
    </>
  );
}
