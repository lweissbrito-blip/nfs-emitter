import { exigirLogin } from '../web/auth';
import { verificar } from '../web/emissao';
import { TestarReceita } from './TestarReceita';
import { ListaVerificacao } from './ListaVerificacao';

export const dynamic = 'force-dynamic';

export default async function Painel() {
  await exigirLogin();
  let itens;
  let erroBanco: string | undefined;
  try {
    itens = await verificar(false);
  } catch (e) {
    erroBanco = (e as Error).message;
  }
  return (
    <>
      <h1>Painel</h1>
      <div className="cartao">
        <h2 style={{ marginTop: 0 }}>O que falta para emitir</h2>
        {erroBanco ? (
          <ListaVerificacao itens={[{ nome: 'Banco de dados', ok: false, detalhe: erroBanco }]} />
        ) : (
          <ListaVerificacao itens={[{ nome: 'Banco de dados', ok: true, detalhe: 'conectado' }, ...itens!]} />
        )}
        <p className="pequeno">
          Empresa e clientes você preenche em <a href="/configuracao">Configuração</a>. O certificado vai nas variáveis de
          ambiente da Vercel (<code>CERT_PFX_BASE64</code> e <code>CERT_SENHA</code>).
        </p>
      </div>
      <div className="cartao">
        <h2 style={{ marginTop: 0 }}>Conexão com a Receita</h2>
        <p className="pequeno">Testa o certificado com mTLS consultando o convênio do seu município. Não emite nada.</p>
        <TestarReceita />
      </div>
    </>
  );
}
