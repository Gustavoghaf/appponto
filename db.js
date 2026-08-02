// db.js
// Escolhe automaticamente o backend de banco de dados:
// - Se DATABASE_URL estiver definida no .env -> usa Postgres (Supabase)
// - Caso contrário -> usa o arquivo local data/db.json (bom para testar sem
//   depender de nenhuma conta externa)
//
// Todo o resto do app (routes/*.js) usa sempre este arquivo, nunca chama
// lib/db-json.js ou lib/db-postgres.js diretamente.

const usandoPostgres = !!process.env.DATABASE_URL;

const impl = usandoPostgres
  ? require('./lib/db-postgres')
  : require('./lib/db-json');

if (usandoPostgres) {
  console.log('[db] Usando Postgres (Supabase) via DATABASE_URL');
} else {
  console.log('[db] Usando banco local em data/db.json (defina DATABASE_URL no .env para usar Postgres)');
}

module.exports = impl;
