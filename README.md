# Emissor de NFS-e — LWEISS

Emite a nota fiscal de serviço de **exportação** direto na API oficial do Emissor Nacional (Sefin Nacional), com o seu e-CNPJ A1. Converte o valor da invoice para reais pela PTAX do Banco Central, salva XML + PDF e registra tudo numa planilha CSV.

Feito para o seu caso: **ME no Simples Nacional, serviço prestado do Brasil para cliente no exterior.** Cliente brasileiro não é suportado nesta versão.

```bash
npm run nota -- meucliente --valor 2500 --producao
```

---

## 1. Instalação (uma vez)

Precisa do **Node.js 20.12 ou mais novo** (`node -v` para conferir).

```bash
npm install
```

### Certificado

1. Crie a pasta `certificado/` e coloque nela o seu e-CNPJ A1 (`.pfx` ou `.p12`).
2. `cp .env.exemplo .env` e preencha o caminho e a senha.

> O `.pfx` e o `.env` dão poder de emitir nota em nome da sua empresa. Eles já estão no `.gitignore`. Nunca suba esses arquivos para GitHub, Drive público etc.

### Empresa

`cp config/empresa.exemplo.json config/empresa.json` e preencha. Cada campo tem uma explicação (`_campo`) no próprio arquivo.

### Clientes

Para cada cliente, copie `config/clientes/cliente.exemplo.json` para `config/clientes/<apelido>.json`. O apelido é o nome que você digita no comando (ex.: `meucliente.json` → `npm run nota -- meucliente ...`).

### O que pedir ao contador

- [ ] **Código de tributação nacional** (6 dígitos) e **código NBS** (9 dígitos) do seu serviço
- [ ] **Alíquota aproximada do Simples** (%)
- [ ] Confirmação de que o serviço é **exportação** (o resultado acontece no exterior)
- [ ] **Critério de conversão** do dólar: o app usa PTAX de **venda** do **dia útil anterior** à emissão (dá para trocar para compra no `empresa.json`, ou informar a cotação na mão com `--cotacao`)
- [ ] Se a empresa tem **Inscrição Municipal**

> Atalho: se você já emitiu alguma nota pelo site do Emissor Nacional, os códigos estão no PDF/XML dela.

### Conferir tudo

```bash
npm run verificar
```

Ele confere a configuração, o certificado (validade e se o CNPJ bate), a conexão com a Receita e a PTAX.

---

## 2. Primeira vez: teste antes de emitir de verdade

Sem `--producao`, tudo vai para o **ambiente de testes** da Receita: as notas são reais no formato, mas não têm valor fiscal.

```bash
# 1) Simulação: monta, valida no schema oficial e assina. NADA é enviado.
npm run nota -- meucliente --valor 2500 --simular

# 2) Envia para o ambiente de testes
npm run nota -- meucliente --valor 2500
```

Abra o PDF e o XML gerados em `notas/testes/` e, de preferência, mostre para o contador antes da primeira nota real.

---

## 3. Uso no dia a dia

```bash
npm run nota -- meucliente --valor 2500 --producao
```

O app mostra um resumo (valor, cotação, valor em reais, descrição) e pede para você digitar `EMITIR`.

| Opção | Para quê |
|---|---|
| `--valor 2500` | Valor da invoice na moeda do cliente (aceita `2500`, `2500.50`, `2.500,50`) |
| `--cotacao 5.43` | Usa essa cotação em vez de buscar a PTAX |
| `--competencia 2026-11-30` | Data de competência (padrão: hoje) |
| `--descricao "..."` | Troca o texto da nota só desta vez |
| `--simular` | Valida tudo sem enviar |
| `--sim` | Pula a confirmação (cuidado) |

### Outros comandos

```bash
npm run consultar -- <chave-de-acesso> --producao      # baixa XML e PDF de uma nota
npm run cancelar  -- <chave> --motivo "Valor digitado errado" --producao
npm run pdf       -- notas/producao/<arquivo>.xml      # gera o PDF de novo
npm run cotacao                                        # mostra a PTAX que seria usada hoje
```

No cancelamento, o motivo precisa ter de 15 a 255 caracteres e a justificativa padrão é "erro na emissão". Use `--servico-nao-prestado` se for o caso.

---

## 4. Onde ficam as coisas

| Pasta | Conteúdo |
|---|---|
| `notas/producao/` | XML e PDF de cada nota (`2026-11_meucliente_nfse-12.pdf`) |
| `dados/producao/notas.csv` | Registro de todas as notas: data, número, cliente, valor em dólar, cotação, valor em reais, chave. Abre no Excel/Sheets |
| `dados/producao/estado.json` | Numeração das notas. **Não apague nem edite** |
| `notas/testes/`, `dados/testes/` | O mesmo, para o ambiente de testes |

O **XML é o documento fiscal oficial**. Guarde por pelo menos 5 anos (faça backup da pasta `notas/`).

---

## 5. Se algo der errado

**Caiu a internet / a Receita não respondeu no meio do envio.**
Rode o mesmo comando de novo. Antes de enviar qualquer coisa, o app pergunta à Receita se aquela nota já foi gerada. Se foi, ele só baixa os arquivos. Se não foi, segue normalmente. Não tem como sair nota duplicada.

**A Receita rejeitou.** Nenhuma nota foi gerada. O app mostra o código e, quando conhece, uma dica. Os mais prováveis:

| Código | O que fazer |
|---|---|
| E0116 | Sua empresa tem Inscrição Municipal: preencha `inscricaoMunicipal` |
| E0120 | Sua empresa não tem Inscrição Municipal no cadastro nacional: deixe vazio |
| E0016 / E1270 | O convênio do município não estava ativo nessa competência. Fale com o contador |
| E0018 | A competência é anterior à abertura do CNPJ |
| E0008 | O relógio do computador está adiantado |

**"O certificado é do CNPJ X, mas o empresa.json diz Y".** O certificado tem que ser do próprio CNPJ que emite.

**Certificado vencendo.** O app avisa quando faltam menos de 30 dias.

---

## 6. O que o app preenche sozinho

Você não precisa saber disso para usar. Está aqui para conferência com o contador.

| Campo | Valor | Por quê |
|---|---|---|
| Série da DPS | `1` (configurável, 1–49999) | Faixa reservada a "aplicativo próprio". O emissor web usa 70000+, então as notas que você já emitiu pelo site não conflitam |
| Tributação do ISSQN | 3, exportação | Sem alíquota e sem retenção (regras E0602/E0580) |
| País do resultado | do cadastro do cliente | Obrigatório na exportação (E0590) |
| Local da prestação | seu município | Você presta o serviço do Brasil |
| Regime | ME/EPP do Simples, apuração pelo SN, sem regime especial | E0166/E0172/E0175 |
| Total de tributos | alíquota aproximada do Simples | Exigência para ME/EPP |
| Comércio exterior | transfronteiriço, sem vínculo, sem mecanismos de apoio, moeda pelo código do Banco Central (USD = 220) | Grupo obrigatório na exportação (E0330) |
| Tomador | Tax ID (NIF) ou "NIF não exigido" + endereço no exterior | E0223 |
| Informações complementares | valor em dólar + cotação usada | Rastreabilidade da conversão |

Nome e endereço da sua empresa **não** vão na DPS: a Receita preenche pelo cadastro do CNPJ.

---

## 7. Atenção

- **IBS/CBS (Reforma Tributária).** Para o Simples Nacional, os campos de IBS/CBS passam a valer em **1º/01/2027**. Antes da primeira nota de 2027, rode `npm update open-nfse` e reveja com o contador se algo muda na nota.
- **PDF.** É gerado localmente (o serviço oficial de PDF da Receita está suspenso, segundo a documentação da biblioteca usada). O que vale juridicamente é o XML. Use `consultar` para baixar uma nota de novo quando precisar.
- **Biblioteca.** A comunicação com a Receita (assinatura, mTLS, validação do schema) usa a [open-nfse](https://github.com/fm-s/open-nfse), open source (MIT) e **não oficial**. A versão está fixada no `package.json` para nada mudar sem você saber.
- **Responsabilidade fiscal.** O app faz o que está configurado. A tributação (código do serviço, exportação, câmbio) é decisão sua com o contador.

---

## 8. Antes de levar para a web (ex.: Vercel)

Hoje o app é uma linha de comando que roda **no seu computador**. Para virar app web, quatro coisas precisam mudar antes da primeira nota real:

1. **Estado fora de arquivo.** A numeração (`dados/*/estado.json`), a emissão pendente e as notas (`notas/`) ficam em arquivos locais. Na Vercel o disco é temporário e é apagado entre execuções. Sem um banco (ex.: Supabase/Postgres), com trava na hora de reservar o número, e um storage para XML/PDF, a numeração se perde, a proteção contra nota duplicada para de funcionar e os XMLs somem. A lógica a portar está em `src/estado.ts` e `resolverPendente()` em `src/cli.ts`.
2. **Login obrigatório.** Sem autenticação, qualquer pessoa com a URL emite nota fiscal no seu CNPJ.
3. **Certificado em variável de ambiente.** O `.pfx` em base64 e a senha vão nas variáveis de ambiente do projeto, nunca no repositório. Quem tiver acesso ao projeto na Vercel tem acesso ao certificado.
4. **Runtime Node.js, não Edge.** O mTLS e a assinatura XML precisam do runtime Node. Aumente o `maxDuration` da função: a Receita pode demorar (o cliente usa timeout de 60 s).

O núcleo que monta a nota (`src/dps.ts`), a configuração (`src/config.ts`) e a cotação (`src/cotacao.ts`) podem ser reaproveitados como estão.
