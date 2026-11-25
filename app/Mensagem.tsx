export function Mensagem({ tipo, texto, detalhes }: { tipo: 'ok' | 'erro' | 'aviso'; texto: string; detalhes?: string[] }) {
  return (
    <div className={`msg ${tipo}`}>
      {texto}
      {detalhes && detalhes.length > 0 && (
        <ul>
          {detalhes.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
