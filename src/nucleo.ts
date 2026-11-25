/**
 * Partes compartilhadas entre a linha de comando e o app web: explicação de
 * erros em português e o texto extra do PDF.
 */
import {
  ExpiredCertificateError,
  ForbiddenError,
  InvalidCertificateError,
  InvalidCertificatePasswordError,
  NetworkError,
  OpenNfseError,
  RuleViolationError,
  TimeoutError,
  TipoTribISSQN,
  UnauthorizedError,
  ValidationError,
  type NFSe,
} from 'open-nfse';
import { ErroConfig } from './validacao';

/**
 * Texto extra para o PDF (área "Outras informações", cabem ~2 linhas): o renderer
 * local não mostra a exportação nem as informações complementares por conta própria.
 */
export function observacoesDanfse(nfse: NFSe): string | undefined {
  const d = nfse.infNFSe.DPS.infDPS;
  const linha1: string[] = [];
  if (d.valores.trib.tribMun.tribISSQN === TipoTribISSQN.ExportacaoServico) {
    linha1.push(`Exportação de serviço (ISSQN não incide), resultado em ${d.valores.trib.tribMun.cPaisResult ?? '—'}.`);
  }
  const loc = d.toma?.end?.localidade;
  if (loc && 'endExt' in loc) {
    linha1.push(`Tomador: ${loc.endExt.xCidade}, ${loc.endExt.xEstProvReg}, ${loc.endExt.cPais} ${loc.endExt.cEndPost}.`);
  }
  const partes = [linha1.join(' '), d.serv.infoCompl?.xInfComp ?? ''].filter(Boolean);
  return partes.length ? partes.join('\n') : undefined;
}

// ---------------------------------------------------------------------------
// Erros em português

export const DICAS: Record<string, string> = {
  E0116: 'Sua empresa tem Inscrição Municipal cadastrada: preencha a Inscrição Municipal nos dados da empresa.',
  E0120: 'Sua empresa NÃO tem Inscrição Municipal no cadastro nacional: deixe a Inscrição Municipal vazia.',
  E0010: 'A série precisa estar entre 1 e 49999 (faixa de aplicativo próprio).',
  E0008: 'O relógio do computador parece adiantado. Acerte a data/hora e tente de novo.',
  E0015: 'A competência não pode ser depois da data de emissão.',
  E0016: 'O município ainda não tinha convênio ativo nessa competência.',
  E1270: 'O convênio do município não está ativo para essa competência.',
  E0018: 'A competência é anterior à abertura do CNPJ.',
  E0529: 'A Receita não aceita exportação para esse cenário. Confirme a tributação com o contador.',
  E0166: 'Regime de apuração do Simples ausente — problema no app, me avise.',
  E0039: 'O município não está liberado para os emissores nacionais NESTE ambiente. No ambiente de testes isso é comum (configuração da prefeitura no servidor de testes) e não indica problema na produção.',
  E1235: 'O XML não segue o leiaute que a Receita espera. Se acontecer perto de uma virada de leiaute (ex.: NT 009 em 01/12/2026), veja NFSE_LEIAUTE_PRODUCAO no README.',
  E1200: 'Certificado de transmissão inválido (precisa ser e-CNPJ com "Autenticação de Cliente").',
};

export function explicarErro(e: unknown): string {
  if (e instanceof ErroConfig) return e.message;
  if (e instanceof InvalidCertificatePasswordError) return 'Senha do certificado incorreta (CERT_SENHA).';
  if (e instanceof ExpiredCertificateError) return 'O certificado está vencido.';
  if (e instanceof InvalidCertificateError) return 'Não consegui ler o certificado (.pfx corrompido ou formato errado).';
  if (e instanceof UnauthorizedError) return 'A Receita recusou o certificado (401).';
  if (e instanceof ForbiddenError) return 'A Receita recusou o acesso (403): o certificado não tem permissão para esse CNPJ.';
  if (e instanceof TimeoutError) return 'A Receita demorou demais para responder.';
  if (e instanceof NetworkError) {
    const causa = (e as { cause?: { code?: string; message?: string } }).cause;
    const detalhe = [causa?.code, causa?.message ?? e.message].filter(Boolean).join(': ');
    return `Sem conexão com a Receita (internet ou servidor fora do ar)${detalhe ? ` — detalhe técnico: ${detalhe}` : ''}.`;
  }
  if (e instanceof RuleViolationError || e instanceof ValidationError) return `Validação local: ${e.message}`;
  if (e instanceof OpenNfseError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
