/**
 * Banco de dados (Postgres/Neon) do app web. Substitui os arquivos locais da
 * linha de comando: configuração, clientes, numeração/pendente e notas emitidas.
 */
import pg from 'pg';

let pool: pg.Pool | undefined;
let pronto: Promise<void> | undefined;

function conexao(): pg.Pool {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL não configurada (conecte o banco Neon ao projeto na Vercel).');
  pool ??= new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
  return pool;
}

const ESQUEMA = `
create table if not exists configuracao (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);
create table if not exists clientes (
  apelido text primary key,
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);
create table if not exists estado (
  ambiente text primary key check (ambiente in ('producao', 'testes')),
  ultimo_numero jsonb not null default '{}',
  pendente jsonb
);
create table if not exists notas (
  id serial primary key,
  ambiente text not null,
  chave text not null unique,
  numero_nfse text,
  n_dps text,
  serie text,
  cliente text,
  tomador text,
  competencia date,
  valor_moeda numeric,
  moeda text,
  cotacao numeric,
  valor_reais numeric,
  xml text not null,
  emitida_em timestamptz not null default now(),
  cancelada_em timestamptz,
  xml_cancelamento text
);
`;

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  texto: string,
  valores: unknown[] = [],
): Promise<T[]> {
  const p = conexao();
  pronto ??= p.query(ESQUEMA).then(
    () => undefined,
    (e) => {
      pronto = undefined;
      throw e;
    },
  );
  await pronto;
  return (await p.query<T>(texto, valores)).rows;
}

export async function fecharConexao() {
  await pool?.end();
  pool = undefined;
  pronto = undefined;
}
