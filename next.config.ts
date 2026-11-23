import type { NextConfig } from 'next';

const config: NextConfig = {
  // open-nfse carrega arquivos em tempo de execução (fontes do PDF, XSD, WASM do xmllint):
  // fica fora do bundle e é copiado inteiro para a função.
  serverExternalPackages: ['open-nfse', 'pg'],
  outputFileTracingIncludes: {
    '/**': ['./node_modules/open-nfse/**/*', './node_modules/xmllint-wasm/**/*', './node_modules/pdfkit/js/data/**/*'],
  },
  // A linha de comando (src/cli.ts, src/config.ts, src/estado.ts) usa disco local e não entra no app.
  poweredByHeader: false,
};

export default config;
