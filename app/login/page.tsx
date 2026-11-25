import { redirect } from 'next/navigation';
import { problemaAuth, sessaoValida } from '../../web/auth';
import { acaoEntrar } from '../acoes';
import { Formulario } from '../Formulario';
import { Mensagem } from '../Mensagem';

export const dynamic = 'force-dynamic';

export default async function Login() {
  if (await sessaoValida()) redirect('/');
  const problema = problemaAuth();
  return (
    <div className="cartao" style={{ maxWidth: 420 }}>
      <h1>Entrar</h1>
      {problema ? (
        <Mensagem
          tipo="erro"
          texto="O login ainda não está configurado."
          detalhes={[problema, 'Cadastre a variável nas configurações do projeto na Vercel e faça um novo deploy.']}
        />
      ) : (
        <Formulario acao={acaoEntrar} botao="Entrar">
          <label htmlFor="senha">Senha</label>
          <input id="senha" name="senha" type="password" autoComplete="current-password" autoFocus required />
        </Formulario>
      )}
    </div>
  );
}
