// lib/db-postgres.js
// Implementação usando Postgres (pensado para Supabase, mas funciona com
// qualquer Postgres). Mesma "interface" de funções que lib/db-json.js,
// para que trocar de um para o outro seja transparente para o resto do app.

const { Pool } = require('pg');
const crypto = require('crypto');
const { dayjs, TZ } = require('./tz');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // necessário para conectar no Supabase
});

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

// Cria as tabelas na primeira vez que o app sobe, se ainda não existirem.
async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funcionarios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      cargo TEXT DEFAULT '',
      pin TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS registros_ponto (
      id TEXT PRIMARY KEY,
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      tipo TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      foto_path TEXT,
      origem TEXT NOT NULL DEFAULT 'funcionario',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ferias (
      id TEXT PRIMARY KEY,
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      data_inicio DATE NOT NULL,
      data_fim DATE NOT NULL,
      observacao TEXT DEFAULT '',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL
    );
  `);

  // Compatibilidade com bancos criados antes da coluna "origem" existir.
  await pool.query(`
    ALTER TABLE registros_ponto ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'funcionario';
  `);
}

// ---------- Funcionários ----------

async function listarFuncionarios() {
  const { rows } = await pool.query('SELECT * FROM funcionarios ORDER BY criado_em');
  return rows;
}

async function buscarFuncionarioPorId(id) {
  const { rows } = await pool.query('SELECT * FROM funcionarios WHERE id = $1', [id]);
  return rows[0] || null;
}

async function buscarFuncionarioPorSlug(slug) {
  const { rows } = await pool.query('SELECT * FROM funcionarios WHERE slug = $1', [slug]);
  return rows[0] || null;
}

async function criarFuncionario({ nome, pin, cargo }) {
  const slug = `${nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${uid().slice(0, 4)}`;
  const id = uid();
  const { rows } = await pool.query(
    `INSERT INTO funcionarios (id, nome, cargo, pin, slug, status)
     VALUES ($1, $2, $3, $4, $5, 'ativo') RETURNING *`,
    [id, nome, cargo || '', String(pin), slug]
  );
  return rows[0];
}

async function atualizarFuncionario(id, campos) {
  const atual = await buscarFuncionarioPorId(id);
  if (!atual) return null;
  const novo = { ...atual, ...campos };
  const { rows } = await pool.query(
    `UPDATE funcionarios SET nome=$1, cargo=$2, pin=$3, status=$4 WHERE id=$5 RETURNING *`,
    [novo.nome, novo.cargo, novo.pin, novo.status, id]
  );
  return rows[0];
}

// ---------- Registros de ponto ----------

async function criarRegistro({ funcionario_id, tipo, foto_path, timestamp, origem }) {
  const id = uid();
  const { rows } = await pool.query(
    `INSERT INTO registros_ponto (id, funcionario_id, tipo, timestamp, foto_path, origem)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, funcionario_id, tipo, timestamp || new Date().toISOString(), foto_path || null, origem || 'funcionario']
  );
  return rows[0];
}

async function buscarRegistroPorId(id) {
  const { rows } = await pool.query('SELECT * FROM registros_ponto WHERE id = $1', [id]);
  return rows[0] || null;
}

async function atualizarRegistro(id, campos) {
  const atual = await buscarRegistroPorId(id);
  if (!atual) return null;
  const novo = { ...atual, ...campos };
  const { rows } = await pool.query(
    `UPDATE registros_ponto SET tipo=$1, timestamp=$2, foto_path=$3 WHERE id=$4 RETURNING *`,
    [novo.tipo, novo.timestamp, novo.foto_path, id]
  );
  return rows[0];
}

async function deletarRegistro(id) {
  const { rowCount } = await pool.query('DELETE FROM registros_ponto WHERE id = $1', [id]);
  return rowCount > 0;
}

async function listarRegistros({ funcionario_id, inicio, fim } = {}) {
  const condicoes = [];
  const valores = [];
  if (funcionario_id) { valores.push(funcionario_id); condicoes.push(`funcionario_id = $${valores.length}`); }
  if (inicio) { valores.push(inicio); condicoes.push(`timestamp >= $${valores.length}`); }
  if (fim) { valores.push(fim); condicoes.push(`timestamp <= $${valores.length}`); }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM registros_ponto ${where} ORDER BY timestamp`, valores);
  return rows;
}

async function ultimoRegistroDoDia(funcionario_id) {
  const inicioDoDia = dayjs().tz(TZ).startOf('day').toISOString();
  const registros = await listarRegistros({ funcionario_id, inicio: inicioDoDia });
  return registros.length ? registros[registros.length - 1] : null;
}

// ---------- Férias ----------

async function criarFerias({ funcionario_id, data_inicio, data_fim, observacao }) {
  const id = uid();
  const { rows } = await pool.query(
    `INSERT INTO ferias (id, funcionario_id, data_inicio, data_fim, observacao)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, funcionario_id, to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio,
               to_char(data_fim, 'YYYY-MM-DD') AS data_fim, observacao, criado_em`,
    [id, funcionario_id, data_inicio, data_fim, observacao || '']
  );
  return rows[0];
}

async function listarFerias({ funcionario_id } = {}) {
  const colunas = `id, funcionario_id, to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio,
                   to_char(data_fim, 'YYYY-MM-DD') AS data_fim, observacao, criado_em`;
  if (funcionario_id) {
    const { rows } = await pool.query(`SELECT ${colunas} FROM ferias WHERE funcionario_id = $1 ORDER BY data_inicio`, [funcionario_id]);
    return rows;
  }
  const { rows } = await pool.query(`SELECT ${colunas} FROM ferias ORDER BY data_inicio`);
  return rows;
}

async function deletarFerias(id) {
  const { rowCount } = await pool.query('DELETE FROM ferias WHERE id = $1', [id]);
  return rowCount > 0;
}

// ---------- Admins ----------

async function listarAdmins() {
  const { rows } = await pool.query('SELECT * FROM admins');
  return rows;
}

async function buscarAdminPorEmail(email) {
  const { rows } = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
  if (!rows[0]) return null;
  return { ...rows[0], senhaHash: rows[0].senha_hash };
}

async function criarAdmin({ email, senhaHash }) {
  const id = uid();
  const { rows } = await pool.query(
    'INSERT INTO admins (id, email, senha_hash) VALUES ($1, $2, $3) RETURNING *',
    [id, email, senhaHash]
  );
  return rows[0];
}

module.exports = {
  migrar,
  listarFuncionarios,
  buscarFuncionarioPorId,
  buscarFuncionarioPorSlug,
  criarFuncionario,
  atualizarFuncionario,
  criarRegistro,
  buscarRegistroPorId,
  atualizarRegistro,
  deletarRegistro,
  listarRegistros,
  ultimoRegistroDoDia,
  criarFerias,
  listarFerias,
  deletarFerias,
  listarAdmins,
  buscarAdminPorEmail,
  criarAdmin
};
