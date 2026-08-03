// db.js
// Banco de dados simples em arquivo JSON. Suficiente para o volume de uma
// pequena empresa (dezenas de funcionários). Para crescer, trocar por
// Supabase/Postgres reaproveitando as mesmas funções (mesma "interface").

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dayjs, TZ } = require('./tz');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function loadRaw() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = { funcionarios: [], registros: [], admins: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function saveRaw(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

// ---------- Funcionários ----------

async function listarFuncionarios() {
  return loadRaw().funcionarios;
}

async function buscarFuncionarioPorId(id) {
  return loadRaw().funcionarios.find(f => f.id === id) || null;
}

async function buscarFuncionarioPorSlug(slug) {
  return loadRaw().funcionarios.find(f => f.slug === slug) || null;
}

async function criarFuncionario({ nome, pin, cargo }) {
  const data = loadRaw();
  const slug = `${nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${uid().slice(0, 4)}`;
  const funcionario = {
    id: uid(),
    nome,
    cargo: cargo || '',
    pin: String(pin),
    slug,
    status: 'ativo',
    criado_em: new Date().toISOString()
  };
  data.funcionarios.push(funcionario);
  saveRaw(data);
  return funcionario;
}

async function atualizarFuncionario(id, campos) {
  const data = loadRaw();
  const idx = data.funcionarios.findIndex(f => f.id === id);
  if (idx === -1) return null;
  data.funcionarios[idx] = { ...data.funcionarios[idx], ...campos };
  saveRaw(data);
  return data.funcionarios[idx];
}

// ---------- Registros de ponto ----------

async function criarRegistro({ funcionario_id, tipo, foto_path, timestamp, origem }) {
  const data = loadRaw();
  const registro = {
    id: uid(),
    funcionario_id,
    tipo, // 'entrada' | 'saida'
    timestamp: timestamp || new Date().toISOString(),
    foto_path: foto_path || null,
    origem: origem || 'funcionario', // 'funcionario' | 'admin'
    criado_em: new Date().toISOString()
  };
  data.registros.push(registro);
  saveRaw(data);
  return registro;
}

async function buscarRegistroPorId(id) {
  return loadRaw().registros.find(r => r.id === id) || null;
}

async function atualizarRegistro(id, campos) {
  const data = loadRaw();
  const idx = data.registros.findIndex(r => r.id === id);
  if (idx === -1) return null;
  data.registros[idx] = { ...data.registros[idx], ...campos };
  saveRaw(data);
  return data.registros[idx];
}

async function deletarRegistro(id) {
  const data = loadRaw();
  const antes = data.registros.length;
  data.registros = data.registros.filter(r => r.id !== id);
  saveRaw(data);
  return data.registros.length < antes;
}

async function listarRegistros({ funcionario_id, inicio, fim } = {}) {
  let registros = loadRaw().registros;
  if (funcionario_id) registros = registros.filter(r => r.funcionario_id === funcionario_id);
  if (inicio) registros = registros.filter(r => r.timestamp >= inicio);
  if (fim) registros = registros.filter(r => r.timestamp <= fim);
  return registros.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function ultimoRegistroDoDia(funcionario_id) {
  const inicioDoDia = dayjs().tz(TZ).startOf('day').toISOString();
  const registros = await listarRegistros({ funcionario_id, inicio: inicioDoDia });
  return registros.length ? registros[registros.length - 1] : null;
}

// ---------- Férias ----------

async function criarFerias({ funcionario_id, data_inicio, data_fim, observacao }) {
  const data = loadRaw();
  if (!data.ferias) data.ferias = [];
  const registro = {
    id: uid(),
    funcionario_id,
    data_inicio, // 'YYYY-MM-DD'
    data_fim,    // 'YYYY-MM-DD'
    observacao: observacao || '',
    criado_em: new Date().toISOString()
  };
  data.ferias.push(registro);
  saveRaw(data);
  return registro;
}

async function listarFerias({ funcionario_id } = {}) {
  const data = loadRaw();
  let ferias = data.ferias || [];
  if (funcionario_id) ferias = ferias.filter(f => f.funcionario_id === funcionario_id);
  return ferias.sort((a, b) => a.data_inicio.localeCompare(b.data_inicio));
}

async function deletarFerias(id) {
  const data = loadRaw();
  if (!data.ferias) return false;
  const antes = data.ferias.length;
  data.ferias = data.ferias.filter(f => f.id !== id);
  saveRaw(data);
  return data.ferias.length < antes;
}

// ---------- Admins ----------

async function listarAdmins() {
  return loadRaw().admins;
}

async function buscarAdminPorEmail(email) {
  return loadRaw().admins.find(a => a.email === email) || null;
}

async function criarAdmin({ email, senhaHash }) {
  const data = loadRaw();
  const admin = { id: uid(), email, senhaHash };
  data.admins.push(admin);
  saveRaw(data);
  return admin;
}

async function migrar() {
  // Nada a fazer no modo JSON: o arquivo é criado automaticamente.
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
