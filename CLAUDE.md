# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-user tool that issues Brazilian **NFS-e for service exports** through the official national API (Sefin Nacional / Emissor Nacional), signed with an e-CNPJ A1 certificate. It exists in two front-ends over the same core: a CLI (`src/cli.ts`, run with `tsx`, local files) and a Next.js web app deployed on Vercel (`app/` + `web/`, Postgres state). Scope is deliberately narrow: an ME on Simples Nacional billing a **foreign** client. Domestic clients are not supported. Code, identifiers, comments, user-facing messages and the README are all in Portuguese; keep it that way.

All communication with the tax authority (XML signing, mTLS, XSD validation, DPS id, PDF rendering, typed errors) is done by the unofficial `open-nfse` library, pinned to an exact version in `package.json` on purpose. Don't loosen the pin.

## Commands

Node ≥ 20.12. `npm install` once.

```bash
npm run verificar [-- --producao]                  # checks config, certificate, connectivity, PTAX
npm run cotacao                                    # shows the PTAX rate that would be used today
npm run nota -- <cliente> --valor 2500 --simular   # build + XSD validate + sign, sends nothing
npm run nota -- <cliente> --valor 2500             # sends to the TEST environment (ProducaoRestrita)
npm run nota -- <cliente> --valor 2500 --producao  # real invoice (asks the user to type EMITIR)
npm run consultar -- <chave> [--producao]
npm run cancelar  -- <chave> --motivo "..." [--servico-nao-prestado] [--producao]
npm run pdf       -- notas/<amb>/<arquivo>.xml
```

Without `--producao` everything targets the test environment. Never run `--producao` (or `--sim`, which skips confirmation) on the user's behalf unless explicitly asked: it creates a legally binding tax document.

Web app and checks:

```bash
npm run dev | build        # Next.js; needs DATABASE_URL, APP_SENHA, APP_SEGREDO, CERT_PFX_BASE64, CERT_SENHA
npm run tipos              # tsc (noEmit, strict) over src/, web/, app/
npm run teste:web          # node:test, web emission flow vs NfseClientFake; needs a LOCAL Postgres (drops tables)
npx tsx --test --test-name-pattern "rejeição" web/emissao.test.ts   # single test
```

`teste:web` needs `DATABASE_URL` on localhost plus `CERT_TESTE_PFX`/`CERT_TESTE_SENHA` (any self-signed `.pfx` with a 14-digit CNPJ in the subject). The fake's synthetic XML is incomplete for the real parser, so PDF tests render from the parsed object. No lint. CLI `--simular` and the web "Gerar prévia" are the real-XSD checks.

Running anything beyond `cotacao` needs local, gitignored files: `.env` (`CERT_ARQUIVO`, `CERT_SENHA`, from `.env.exemplo`), the `.pfx` under `certificado/`, `config/empresa.json` and `config/clientes/<apelido>.json` (from the `*.exemplo.json` files, which document each field via `_campo` keys).

## Architecture

Relative imports are extensionless (`'./dps'`): Turbopack doesn't map `.js` → `.ts`, and `tsx` resolves either way. `tsconfig` uses `moduleResolution: bundler`.

### Shared core (`src/`)

- `src/cli.ts`: CLI entry point and every command (`cmdVerificar`, `cmdNota`, `cmdConsultar`, `cmdCancelar`, `cmdPdf`, `cmdCotacao`), argument parsing (`node:util` `parseArgs`), saving XML + PDF. The API client comes from a swappable factory; `usarFabricaApi()` exists so tests can inject a fake `NfseClientLike` from `open-nfse/testing`.
- `src/validacao.ts`: pure validation of empresa/cliente objects (`validarEmpresa`, `validarCliente`). Collects all problems and throws `ErroConfig` with the full list. Rejects placeholder values (`PREENCHER`, all-zero codes). Maps ISO currency to BACEN codes (`MOEDAS_BACEN`: USD=220, EUR=978). Used by both front-ends.
- `src/config.ts` (CLI only): reads `config/*.json` and `.env` and calls `validacao`. `RAIZ` uses `import.meta.dirname`, so web code must never import `config.ts`, `estado.ts` or `cli.ts`.
- `src/nucleo.ts`: `explicarErro`, `DICAS` (Receita rejection codes → hints) and `observacoesDanfse()`, shared by both.
- `src/dps.ts`: `montarDps()` is a pure function that builds the DPS object. Each hard-coded field choice there exists to satisfy a specific Receita validation rule (E0330, E0223, E0166, E0602…, listed in the doc comment and in README §6). Check those rules before changing a field. Text fields go through `latin1()` because the layout only accepts Latin-1. `dhEmi` is backdated 1 minute to avoid E0008.
- `src/cotacao.ts`: BCB PTAX (Olinda API). Uses the business day **before** the issue date, walking back over weekends and holidays. Dates are handled as `AAAA-MM-DD` strings in the Brasília timezone (`hojeBrasilia()`), never the machine's local timezone.
- `src/estado.ts`: `Armazem` holds local state per environment (`dados/{producao,testes}/` and `notas/{producao,testes}/`, numbered independently): last DPS number per series, the single **pending** emission, and the `notas.csv` log (`;`-separated, decimal comma for Excel pt-BR). `estado.json` is written atomically (tmp file + rename).

### Web app (`web/` server logic, `app/` Next.js App Router)

- `web/emissao.ts` ports `cmdNota`/`resolverPendente` (`previa`, `emitir`, `verificarPendente`, `cancelar`, `importarPorChave`, `verificar`, `pdfDaNota`) and returns result objects instead of printing. `usarFabricaApi()` swaps in the fake for tests.
- `web/armazem.ts` is the DB equivalent of `Armazem`. `reservar()` is the lock: an `UPDATE … WHERE pendente IS NULL AND ultimo+1 = nDPS`. `liberar()` only clears the pending entry with a matching `idDps`.
- `web/db.ts` creates the schema lazily (`create table if not exists`) on first query. No migration tool.
- `web/config.ts`: empresa and clientes are raw JSON in Postgres (same shape as the `.exemplo.json` files), validated on save and on load. The certificate comes from `CERT_PFX_BASE64` + `CERT_SENHA`.
- `web/auth.ts`: single password (`APP_SENHA`), HMAC-signed cookie keyed by `APP_SEGREDO` + `APP_SENHA`, fail closed if either is missing. **Every page, server action (`app/acoes.ts`) and route handler must call `exigirLogin()`/`sessaoValida()` itself.** There is no middleware.
- `web/campos.ts` defines the empresa/cliente form fields (dotted names → nested JSON).
- Forms submit through `onSubmit` + `startTransition`, not `<form action>`, because React 19 resets the form after an action and validation errors would wipe the input.
- Vercel: project `emissor-nfse`, Neon store `emissor-nfse-db`, both in `gru1`. `vercel.json` sets the region and `maxDuration: 120`. `next.config.ts` keeps `open-nfse` and `pg` external and traces their runtime files (XSD, WASM, PDF fonts).

### Emission flow and duplicate protection (the critical invariant)

`cmdNota` in `src/cli.ts` (mirrored by `emitir` in `web/emissao.ts`):
1. `resolverPendente()`: if a previous emission was left unconfirmed, ask the Receita (`fetchDpsStatus` → `fetchByChave`). If the note exists, save it, confirm the number and stop. On `NotFoundError`, clear the pending entry and reuse the number. On any other error, abort without sending anything.
2. Reserve `proximoNumero`, build the DPS, run a local dry run (`emitirDpsPronta(..., { dryRun: true })`), show a summary and confirm.
3. `definirPendente(...)` **before** sending, then send.
4. Error classification decides what happens to the number. `ReceitaRejectionError` or validation/auth/certificate errors mean nothing was processed: clear the pending entry (E0014 = number already used, so advance the counter). Network, timeout, 5xx, 429 or anything unknown means the outcome is unknown: **keep** the pending entry so the next run reconciles it.

Changes to this flow must preserve "never send a new DPS while an earlier one is unresolved". The web version adds one rule: a pending entry younger than 3 minutes (longer than `maxDuration`) may belong to a request still in flight, so it is neither queried nor cleared. The user is told to wait. `npm run teste:web` covers these paths, so run it after touching the flow.

## Notes

- The PDF is rendered locally (the official PDF service is suspended). The XML is the legal document. `observacoesDanfse()` adds export/conversion info that the local renderer doesn't show.
- IBS/CBS (tax reform) fields become mandatory for Simples Nacional on 2027-01-01. Expect an `open-nfse` upgrade and DPS changes around then.
- CLI and web keep separate numbering (local `estado.json` vs Postgres). The web app recovers from numbers the CLI already used via E0014 (advances the counter).
- Never commit `.env`, `certificado/`, `*.pfx`/`*.p12`, `dados/`, `notas/`, `config/empresa.json` or real client files (all gitignored). Never set `CERT_*` or `APP_SENHA` on Vercel for the user. They enter them as Sensitive vars.
