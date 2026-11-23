import Link from 'next/link';
import { exigirLogin } from '../../web/auth';
import { CAMPOS_EMPRESA } from '../../web/campos';
import { lerEmpresaBruta, listarClientesBrutos } from '../../web/config';
import { acaoSalvarEmpresa } from '../acoes';
import { CamposForm } from '../CamposForm';
import { Formulario } from '../Formulario';

export const dynamic = 'force-dynamic';

export default async function Configuracao() {
  await exigirLogin();
  const [empresa, clientes] = await Promise.all([lerEmpresaBruta(), listarClientesBrutos()]);
  return (
    <>
      <h1>Configuração</h1>
      <div className="cartao">
        <h2 style={{ marginTop: 0 }}>Empresa</h2>
        <p className="pequeno">
          Nome e endereço da empresa não vão na nota: a Receita preenche pelo cadastro do CNPJ. Atalho: se você já emitiu
          alguma nota pelo site do Emissor Nacional, os códigos estão no PDF/XML dela.
        </p>
        <Formulario acao={acaoSalvarEmpresa} botao="Salvar empresa">
          <CamposForm campos={CAMPOS_EMPRESA} dados={empresa} />
        </Formulario>
      </div>
      <div className="cartao">
        <h2 style={{ marginTop: 0 }}>Clientes</h2>
        {clientes.length === 0 ? (
          <p>Nenhum cliente ainda.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Apelido</th>
                <th>Nome</th>
                <th>País</th>
                <th>Moeda</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.apelido}>
                  <td>{c.apelido}</td>
                  <td>{String(c.dados.nome ?? '')}</td>
                  <td>{String((c.dados.endereco as Record<string, unknown> | undefined)?.pais ?? '')}</td>
                  <td>{String(c.dados.moeda ?? '')}</td>
                  <td>
                    <Link href={`/configuracao/clientes/${c.apelido}`}>editar</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Link className="botao" href="/configuracao/clientes/novo">
          Novo cliente
        </Link>
      </div>
    </>
  );
}
