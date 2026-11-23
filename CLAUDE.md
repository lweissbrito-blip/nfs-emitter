# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-user CLI (TypeScript, run directly with `tsx`, no build step) that issues Brazilian **NFS-e for service exports** through the official national API (Sefin Nacional / Emissor Nacional), signed with an e-CNPJ A1 certificate. Scope is deliberately narrow: an ME on Simples Nacional billing a **foreign** client. Domestic clients are not supported. Code, identifiers, comments, user-facing messages and the README are all in Portuguese; keep it that way.

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

There is no test suite, lint, or typecheck script in `package.json`, and `typescript` is not a dependency. `tsconfig.json` is `noEmit` + strict, so a typecheck is `npx -p typescript tsc -p .`. `--simular` is the end-to-end check that a DPS passes the official schema.

Running anything beyond `cotacao` needs local, gitignored files: `.env` (`CERT_ARQUIVO`, `CERT_SENHA`, from `.env.exemplo`), the `.pfx` under `certificado/`, `config/empresa.json` and `config/clientes/<apelido>.json` (from the `*.exemplo.json` files, which document each field via `_campo` keys).

## Architecture

- `src/cli.ts`: entry point and every command (`cmdVerificar`, `cmdNota`, `cmdConsultar`, `cmdCancelar`, `cmdPdf`, `cmdCotacao`), argument parsing (`node:util` `parseArgs`), saving XML + PDF, and error explanations (`explicarErro`, which maps Receita rejection codes to hints). The API client comes from a swappable factory; `usarFabricaApi()` exists so tests can inject a fake `NfseClientLike` from `open-nfse/testing`.
- `src/config.ts`: loads and validates `empresa.json`, client files and the certificate config. Collects all problems and throws `ErroConfig` with the full list. Rejects placeholder values (`PREENCHER`, all-zero codes). Maps ISO currency to BACEN codes (`MOEDAS_BACEN`: USD=220, EUR=978). `RAIZ` (repo root) anchors every path.
- `src/dps.ts`: `montarDps()` is a pure function that builds the DPS object. Each hard-coded field choice there exists to satisfy a specific Receita validation rule (E0330, E0223, E0166, E0602…, listed in the doc comment and in README §6). Check those rules before changing a field. Text fields go through `latin1()` because the layout only accepts Latin-1. `dhEmi` is backdated 1 minute to avoid E0008.
- `src/cotacao.ts`: BCB PTAX (Olinda API). Uses the business day **before** the issue date, walking back over weekends and holidays. Dates are handled as `AAAA-MM-DD` strings in the Brasília timezone (`hojeBrasilia()`), never the machine's local timezone.
- `src/estado.ts`: `Armazem` holds local state per environment (`dados/{producao,testes}/` and `notas/{producao,testes}/`, numbered independently): last DPS number per series, the single **pending** emission, and the `notas.csv` log (`;`-separated, decimal comma for Excel pt-BR). `estado.json` is written atomically (tmp file + rename).

### Emission flow and duplicate protection (the critical invariant)

`cmdNota` in `src/cli.ts`:
1. `resolverPendente()`: if a previous emission was left unconfirmed, ask the Receita (`fetchDpsStatus` → `fetchByChave`). If the note exists, save it, confirm the number and stop. On `NotFoundError`, clear the pending entry and reuse the number. On any other error, abort without sending anything.
2. Reserve `proximoNumero`, build the DPS, run a local dry run (`emitirDpsPronta(..., { dryRun: true })`), show a summary and confirm.
3. `definirPendente(...)` **before** sending, then send.
4. Error classification decides what happens to the number. `ReceitaRejectionError` or validation/auth/certificate errors mean nothing was processed: clear the pending entry (E0014 = number already used, so advance the counter). Network, timeout, 5xx, 429 or anything unknown means the outcome is unknown: **keep** the pending entry so the next run reconciles it.

Changes to this flow must preserve "never send a new DPS while an earlier one is unresolved". README §8 lists what has to change before any web deployment (DB-backed state with locking, auth, certificate via env, Node runtime rather than Edge). `dps.ts`, `config.ts` and `cotacao.ts` are meant to be reusable as they are.

## Notes

- The PDF is rendered locally (the official PDF service is suspended). The XML is the legal document. `observacoesDanfse()` adds export/conversion info that the local renderer doesn't show.
- IBS/CBS (tax reform) fields become mandatory for Simples Nacional on 2027-01-01. Expect an `open-nfse` upgrade and DPS changes around then.
- Never commit `.env`, `certificado/`, `*.pfx`/`*.p12`, `dados/`, `notas/`, `config/empresa.json` or real client files (all gitignored).
