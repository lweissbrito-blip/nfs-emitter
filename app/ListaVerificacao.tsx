import type { ItemVerificacao } from '../web/emissao';

export function ListaVerificacao({ itens }: { itens: ItemVerificacao[] }) {
  return (
    <ul className="lista-check">
      {itens.map((i) => (
        <li key={i.nome}>
          {i.ok === true ? '✅' : i.ok === 'aviso' ? '⚠️' : '❌'} <strong>{i.nome}</strong>
          <span style={{ whiteSpace: 'pre-line' }}> — {i.detalhe}</span>
        </li>
      ))}
    </ul>
  );
}
