import type { Campo } from '../web/campos';
import { valorDe } from '../web/campos';

function UmCampo({ c, dados }: { c: Campo; dados?: Record<string, unknown> }) {
  const valor = (dados ? valorDe(dados, c.nome) : '') || c.padrao || '';
  return (
    <div>
      <label htmlFor={c.nome}>
        {c.rotulo}
        {c.obrigatorio && ' *'}
        {c.ajuda && <div className="ajuda">{c.ajuda}</div>}
      </label>
      {c.tipo === 'select' ? (
        <select id={c.nome} name={c.nome} defaultValue={valor}>
          {c.opcoes!.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      ) : c.tipo === 'area' ? (
        <textarea id={c.nome} name={c.nome} defaultValue={valor} />
      ) : (
        <input id={c.nome} name={c.nome} defaultValue={valor} inputMode={c.tipo === 'numero' ? 'decimal' : undefined} />
      )}
    </div>
  );
}

export function CamposForm({ campos, dados }: { campos: Campo[]; dados?: Record<string, unknown> }) {
  const basicos = campos.filter((c) => !c.avancado);
  const avancados = campos.filter((c) => c.avancado);
  return (
    <>
      <div className="grade">
        {basicos.map((c) => (
          <UmCampo key={c.nome} c={c} dados={dados} />
        ))}
      </div>
      {avancados.length > 0 && (
        <details>
          <summary>Campos avançados (só mude se o contador pedir)</summary>
          <div className="grade">
            {avancados.map((c) => (
              <UmCampo key={c.nome} c={c} dados={dados} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}
