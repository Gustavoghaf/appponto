// setup-google-drive.js
// Rode uma única vez para autorizar o app a salvar fotos no Google Drive
// da conta que você escolher (a conta que "vai guardar" as fotos).
//
// Uso: node setup-google-drive.js
//
// Antes de rodar, preencha no .env:
//   GOOGLE_OAUTH_CLIENT_ID=...
//   GOOGLE_OAUTH_CLIENT_SECRET=...
// (veja o README para como conseguir esses dois valores)

require('dotenv').config();
const http = require('http');
const { google } = require('googleapis');

const PORTA = 53682;
const REDIRECT_URI = `http://localhost:${PORTA}/oauth2callback`;

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log('Antes de rodar este script, preencha no .env:');
    console.log('  GOOGLE_OAUTH_CLIENT_ID=...');
    console.log('  GOOGLE_OAUTH_CLIENT_SECRET=...');
    console.log('(veja o README, seção "Google Drive", para como conseguir esses valores)');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // força gerar um refresh_token novo mesmo se já autorizou antes
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });

  console.log('\n1. Abra este link no navegador, usando a conta Google que vai guardar as fotos:\n');
  console.log(authUrl);
  console.log('\n2. Faça login e clique em "Permitir".');
  console.log('3. Você será redirecionado de volta automaticamente — não feche este terminal.\n');
  console.log('Aguardando autorização...\n');

  const code = await esperarCodigo();

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.log('\n⚠️  Não veio um refresh_token na resposta. Isso costuma acontecer se essa');
    console.log('conta já autorizou este app antes. Revogue o acesso em');
    console.log('https://myaccount.google.com/permissions e rode este script de novo.');
    process.exit(1);
  }

  console.log('\n✅ Sucesso! Adicione esta linha ao seu .env:\n');
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  process.exit(0);
}

function esperarCodigo() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url.startsWith('/oauth2callback')) return;
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get('code');
      const erro = url.searchParams.get('error');

      if (erro) {
        res.end('Autorização negada. Pode fechar esta aba e conferir o terminal.');
        server.close();
        return reject(new Error(erro));
      }

      res.end('Autorizado com sucesso! Pode fechar esta aba e voltar para o terminal.');
      server.close();
      resolve(code);
    });
    server.listen(PORTA);
  });
}

main().catch(err => {
  console.error('Erro:', err.message || err);
  process.exit(1);
});
