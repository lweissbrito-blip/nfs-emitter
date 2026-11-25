/**
 * Estado local do emissor: último número de DPS usado por série, a tentativa
 * pendente (se a última emissão caiu no meio do caminho) e o registro em CSV.
 *
 * Testes e produção têm pastas separadas, porque a numeração é independente.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RAIZ } from './config';

export interface Pendente {
  nDPS: string;
  serie: string;
  idDps: string;
  cliente: string;
  valorMoeda: number;
  moeda: string;
  valorReais: number;
  cotacao: number;
  competencia: string;
  criadoEm: string;
}

interface Estado {
  ultimoNumero: Record<string, number>;
  pendente: Pendente | null;
}

export class Armazem {
  readonly pastaDados: string;
  readonly pastaNotas: string;
  private readonly arquivoEstado: string;

  constructor(readonly producao: boolean) {
    const amb = producao ? 'producao' : 'testes';
    this.pastaDados = path.join(RAIZ, 'dados', amb);
    this.pastaNotas = path.join(RAIZ, 'notas', amb);
    this.arquivoEstado = path.join(this.pastaDados, 'estado.json');
    mkdirSync(this.pastaDados, { recursive: true });
    mkdirSync(this.pastaNotas, { recursive: true });
  }

  private ler(): Estado {
    if (!existsSync(this.arquivoEstado)) return { ultimoNumero: {}, pendente: null };
    return JSON.parse(readFileSync(this.arquivoEstado, 'utf8')) as Estado;
  }

  private gravar(e: Estado) {
    // Grava num temporário e renomeia: se o processo cair no meio, o arquivo antigo fica intacto.
    const tmp = `${this.arquivoEstado}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(e, null, 2)}\n`);
    renameSync(tmp, this.arquivoEstado);
  }

  proximoNumero(serie: string): string {
    return String((this.ler().ultimoNumero[serie] ?? 0) + 1);
  }

  /** Marca um número como consumido (só avança, nunca volta). */
  confirmarNumero(serie: string, nDPS: string) {
    const e = this.ler();
    e.ultimoNumero[serie] = Math.max(e.ultimoNumero[serie] ?? 0, Number(nDPS));
    this.gravar(e);
  }

  pendente(): Pendente | null {
    return this.ler().pendente;
  }

  definirPendente(p: Pendente | null) {
    const e = this.ler();
    e.pendente = p;
    this.gravar(e);
  }

  registrar(linha: {
    dataEmissao: string;
    numeroNfse: string;
    nDPS: string;
    cliente: string;
    competencia: string;
    valorMoeda: number;
    moeda: string;
    cotacao: number | '';
    valorReais: number;
    chave: string;
    arquivoPdf: string;
  }) {
    const arq = path.join(this.pastaDados, 'notas.csv');
    if (!existsSync(arq)) {
      writeFileSync(
        arq,
        'data_emissao;numero_nfse;n_dps;cliente;competencia;valor_moeda;moeda;cotacao;valor_reais;chave_acesso;pdf\n',
      );
    }
    const num = (n: number | '') => (n === '' ? '' : String(n).replace('.', ','));
    appendFileSync(
      arq,
      [
        linha.dataEmissao,
        linha.numeroNfse,
        linha.nDPS,
        linha.cliente,
        linha.competencia,
        num(linha.valorMoeda),
        linha.moeda,
        num(linha.cotacao),
        num(linha.valorReais),
        linha.chave,
        path.relative(RAIZ, linha.arquivoPdf),
      ].join(';') + '\n',
    );
  }
}
