// Script para criar (ou resetar a senha de) o administrador inicial.
// Uso: node setup-admin.js email@empresa.com minhasenha123

require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('./db');

async function main() {
  const [, , email, senha] = process.argv;
  if (!email || !senha) {
    console.log('Uso: node setup-admin.js <email> <senha>');
    process.exit(1);
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  await db.migrar();
  const existente = await db.buscarAdminPorEmail(email);

  if (existente) {
    console.log('Admin já existe. Use o painel para trocar a senha, ou edite data/db.json manualmente.');
    process.exit(0);
  }

  await db.criarAdmin({ email, senhaHash });
  console.log(`Admin criado com sucesso: ${email}`);
}

main();
