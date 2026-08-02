const express = require('express');
const router = express.Router();
const db = require('../db');
const storage = require('../storage');

async function estaDeFeriasHoje(funcionario_id) {
  const hoje = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const ferias = await db.listarFerias({ funcionario_id });
  return ferias.some(f => hoje >= f.data_inicio && hoje <= f.data_fim);
}

// Retorna dados públicos do funcionário + qual é a próxima ação (entrada/saída)
router.get('/:slug/status', async (req, res) => {
  const funcionario = await db.buscarFuncionarioPorSlug(req.params.slug);
  if (!funcionario || funcionario.status !== 'ativo') {
    return res.status(404).json({ erro: 'Ponto não encontrado ou inativo.' });
  }

  const emFerias = await estaDeFeriasHoje(funcionario.id);
  if (emFerias) {
    return res.json({ nome: funcionario.nome, emFerias: true });
  }

  const ultimo = await db.ultimoRegistroDoDia(funcionario.id);
  const proximaAcao = !ultimo || ultimo.tipo === 'saida' ? 'entrada' : 'saida';

  res.json({
    nome: funcionario.nome,
    proximaAcao,
    ultimoRegistro: ultimo ? { tipo: ultimo.tipo, timestamp: ultimo.timestamp } : null
  });
});

// Registra entrada ou saída (valida PIN, salva foto, grava horário do servidor)
router.post('/:slug/registrar', async (req, res) => {
  const funcionario = await db.buscarFuncionarioPorSlug(req.params.slug);
  if (!funcionario || funcionario.status !== 'ativo') {
    return res.status(404).json({ erro: 'Ponto não encontrado ou inativo.' });
  }

  const { pin, foto } = req.body;
  if (!pin || String(pin) !== String(funcionario.pin)) {
    return res.status(401).json({ erro: 'PIN incorreto.' });
  }

  if (await estaDeFeriasHoje(funcionario.id)) {
    return res.status(403).json({ erro: 'Você está de férias. Não é possível registrar ponto hoje.' });
  }

  if (!foto) {
    return res.status(400).json({ erro: 'Foto é obrigatória.' });
  }

  const ultimo = await db.ultimoRegistroDoDia(funcionario.id);
  const tipo = !ultimo || ultimo.tipo === 'saida' ? 'entrada' : 'saida';

  try {
    const foto_path = await storage.salvarFoto({ funcionario_id: funcionario.id, nomeFuncionario: funcionario.nome, base64Data: foto, tipo });
    const registro = await db.criarRegistro({ funcionario_id: funcionario.id, tipo, foto_path });
    res.json({ ok: true, tipo, timestamp: registro.timestamp });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro ao salvar registro.' });
  }
});

module.exports = router;
