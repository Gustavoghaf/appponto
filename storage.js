// storage.js
// Ponto único de integração para salvar as fotos do ponto.
//
// Se as variáveis GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
// GOOGLE_OAUTH_REFRESH_TOKEN e GOOGLE_DRIVE_FOLDER_ID estiverem definidas
// no .env, as fotos vão para o Google Drive. Caso contrário, salva
// localmente em /uploads (bom para testar sem depender de nenhuma conta externa).
//
// IMPORTANTE: usamos OAuth2 (autenticando como a conta real do Google que
// vai guardar as fotos), e não Service Account. Service Account não tem
// cota de armazenamento própria em contas Gmail comuns (só funciona com
// Drives Compartilhados, que exigem Google Workspace pago) — daria erro
// "Service Accounts do not have storage quota". Rode `node setup-google-drive.js`
// uma vez para gerar o GOOGLE_OAUTH_REFRESH_TOKEN (veja o README).

const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, 'uploads');

const usandoDrive = !!(
  process.env.GOOGLE_OAUTH_CLIENT_ID &&
  process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
  process.env.GOOGLE_OAUTH_REFRESH_TOKEN &&
  process.env.GOOGLE_DRIVE_FOLDER_ID
);

let driveClient = null;

function getDriveClient() {
  if (driveClient) return driveClient;
  const { google } = require('googleapis');

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });

  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  return driveClient;
}

function base64ParaBuffer(base64Data) {
  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  const ext = matches ? matches[1] : 'jpg';
  const buffer = Buffer.from(matches ? matches[2] : base64Data, 'base64');
  return { ext, buffer };
}

async function salvarFotoLocal({ funcionario_id, base64Data, tipo }) {
  const dir = path.join(UPLOADS_DIR, funcionario_id);
  fs.mkdirSync(dir, { recursive: true });

  const { ext, buffer } = base64ParaBuffer(base64Data);
  const filename = `${Date.now()}-${tipo}.${ext}`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, buffer);

  return `/uploads/${funcionario_id}/${filename}`;
}

async function salvarFotoDrive({ funcionario_id, nomeFuncionario, base64Data, tipo }) {
  const { Readable } = require('stream');
  const drive = getDriveClient();
  const { ext, buffer } = base64ParaBuffer(base64Data);

  const dataHoje = new Date().toISOString().slice(0, 10);
  const filename = `${(nomeFuncionario || funcionario_id).replace(/[^a-zA-Z0-9 ]/g, '')}_${tipo}_${dataHoje}_${Date.now()}.${ext}`;

  let res;
  try {
    res = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: `image/${ext}`,
        body: Readable.from(buffer),
      },
      fields: 'id, webViewLink',
    });
  } catch (e) {
    console.error('[storage] Erro ao enviar foto para o Google Drive:', e.message || e);
    throw e;
  }

  // Deixa o arquivo visível para quem tiver o link (necessário para abrir
  // a foto direto do painel admin sem precisar estar logado na mesma conta Google).
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return res.data.webViewLink;
}

async function salvarFoto({ funcionario_id, nomeFuncionario, base64Data, tipo }) {
  if (usandoDrive) {
    return salvarFotoDrive({ funcionario_id, nomeFuncionario, base64Data, tipo });
  }
  return salvarFotoLocal({ funcionario_id, base64Data, tipo });
}

module.exports = { salvarFoto, UPLOADS_DIR, usandoDrive };
