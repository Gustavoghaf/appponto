const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(isoWeek);
const PDFDocument = require('pdfkit');
const db = require('../db');

function exigirLogin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ erro: 'Não autenticado.' });
  next();
}

// ---------- Autenticação ----------

router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  const admin = await db.buscarAdminPorEmail(email);
  if (!admin || !(await bcrypt.compare(senha, admin.senhaHash))) {
    return res.status(401).json({ erro: 'Credenciais inválidas.' });
  }
  req.session.adminId = admin.id;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  res.json({ logado: !!req.session.adminId });
});

// A partir daqui, todas as rotas exigem login
router.use(exigirLogin);

// ---------- Funcionários ----------

router.get('/funcionarios', async (req, res) => {
  const funcionarios = await db.listarFuncionarios();
  res.json(funcionarios.map(f => ({
    id: f.id, nome: f.nome, cargo: f.cargo, status: f.status, slug: f.slug, criado_em: f.criado_em
  })));
});

router.post('/funcionarios', async (req, res) => {
  const { nome, cargo, pin } = req.body;
  if (!nome || !pin) return res.status(400).json({ erro: 'Nome e PIN são obrigatórios.' });
  if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ erro: 'PIN deve ter de 4 a 6 dígitos.' });

  const existentes = await db.listarFuncionarios();
  const jaExiste = existentes.some(f => f.nome.trim().toLowerCase() === nome.trim().toLowerCase());
  if (jaExiste) return res.status(400).json({ erro: 'Já existe um funcionário cadastrado com esse nome.' });

  const funcionario = await db.criarFuncionario({ nome, cargo, pin });
  res.json(funcionario);
});

router.put('/funcionarios/:id', async (req, res) => {
  const { nome, cargo, pin, status } = req.body;
  const campos = {};
  if (nome) campos.nome = nome;
  if (cargo !== undefined) campos.cargo = cargo;
  if (pin) {
    if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ erro: 'PIN deve ter de 4 a 6 dígitos.' });
    campos.pin = String(pin);
  }
  if (status) campos.status = status; // 'ativo' | 'inativo'

  const atualizado = await db.atualizarFuncionario(req.params.id, campos);
  if (!atualizado) return res.status(404).json({ erro: 'Funcionário não encontrado.' });
  res.json(atualizado);
});

// Gera o QR code (PNG em base64) do link de ponto do funcionário
router.get('/funcionarios/:id/qrcode', async (req, res) => {
  const funcionario = await db.buscarFuncionarioPorId(req.params.id);
  if (!funcionario) return res.status(404).json({ erro: 'Funcionário não encontrado.' });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const link = `${baseUrl}/ponto/${funcionario.slug}`;
  const qrDataUrl = await QRCode.toDataURL(link);
  res.json({ link, qrDataUrl });
});

// ---------- Férias ----------

router.get('/ferias', async (req, res) => {
  const { funcionario_id } = req.query;
  const ferias = await db.listarFerias({ funcionario_id });
  res.json(ferias);
});

router.post('/ferias', async (req, res) => {
  const { funcionario_id, data_inicio, data_fim, observacao } = req.body;
  if (!funcionario_id || !data_inicio || !data_fim) {
    return res.status(400).json({ erro: 'Funcionário, data de início e data de fim são obrigatórios.' });
  }
  if (data_fim < data_inicio) {
    return res.status(400).json({ erro: 'Data de fim não pode ser antes da data de início.' });
  }
  const registro = await db.criarFerias({ funcionario_id, data_inicio, data_fim, observacao });
  res.json(registro);
});

router.delete('/ferias/:id', async (req, res) => {
  const ok = await db.deletarFerias(req.params.id);
  if (!ok) return res.status(404).json({ erro: 'Registro de férias não encontrado.' });
  res.json({ ok: true });
});

// ---------- Registros e relatórios ----------

router.get('/registros', async (req, res) => {
  const { funcionario_id, inicio, fim } = req.query;
  const registros = await db.listarRegistros({ funcionario_id, inicio, fim });
  res.json(registros);
});

// Correção manual: supervisão insere um registro que o funcionário esqueceu
router.post('/registros', async (req, res) => {
  const { funcionario_id, tipo, timestamp } = req.body;
  if (!funcionario_id || !tipo || !timestamp) {
    return res.status(400).json({ erro: 'Funcionário, tipo e horário são obrigatórios.' });
  }
  if (!['entrada', 'saida'].includes(tipo)) {
    return res.status(400).json({ erro: 'Tipo deve ser "entrada" ou "saida".' });
  }
  const registro = await db.criarRegistro({
    funcionario_id, tipo,
    timestamp: new Date(timestamp).toISOString(),
    origem: 'admin'
  });
  res.json(registro);
});

// Correção manual: supervisão ajusta tipo/horário de um registro existente
router.put('/registros/:id', async (req, res) => {
  const { tipo, timestamp } = req.body;
  const campos = {};
  if (tipo) {
    if (!['entrada', 'saida'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
    campos.tipo = tipo;
  }
  if (timestamp) campos.timestamp = new Date(timestamp).toISOString();

  const atualizado = await db.atualizarRegistro(req.params.id, campos);
  if (!atualizado) return res.status(404).json({ erro: 'Registro não encontrado.' });
  res.json(atualizado);
});

router.delete('/registros/:id', async (req, res) => {
  const ok = await db.deletarRegistro(req.params.id);
  if (!ok) return res.status(404).json({ erro: 'Registro não encontrado.' });
  res.json({ ok: true });
});

// Resumo de horas trabalhadas hoje e na semana atual (para o painel)
router.get('/resumo/:funcionario_id', async (req, res) => {
  const inicioSemana = dayjs().startOf('week');
  const inicioHoje = dayjs().startOf('day');

  const registrosSemana = await db.listarRegistros({
    funcionario_id: req.params.funcionario_id,
    inicio: inicioSemana.toISOString()
  });

  function somarMinutos(registros) {
    const porDia = {};
    registros.forEach(r => {
      const dia = dayjs(r.timestamp).format('YYYY-MM-DD');
      porDia[dia] = porDia[dia] || {};
      porDia[dia][r.tipo] = r.timestamp;
    });
    let minutos = 0;
    Object.values(porDia).forEach(d => {
      if (d.entrada && d.saida) minutos += dayjs(d.saida).diff(dayjs(d.entrada), 'minute');
    });
    return minutos;
  }

  const minutosSemana = somarMinutos(registrosSemana);
  const minutosHoje = somarMinutos(registrosSemana.filter(r => dayjs(r.timestamp).isAfter(inicioHoje)));

  const formatar = min => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

  res.json({
    horasHoje: formatar(minutosHoje),
    horasSemana: formatar(minutosSemana)
  });
});

router.get('/relatorio.csv', async (req, res) => {
  const { funcionario_id, inicio, fim } = req.query;
  const registros = await db.listarRegistros({ funcionario_id, inicio, fim });
  const funcionarios = Object.fromEntries((await db.listarFuncionarios()).map(f => [f.id, f.nome]));

  const linhas = ['Funcionario,Tipo,Data,Hora,Foto'];
  registros.forEach(r => {
    const dt = dayjs(r.timestamp);
    linhas.push([
      funcionarios[r.funcionario_id] || r.funcionario_id,
      r.tipo,
      dt.format('DD/MM/YYYY'),
      dt.format('HH:mm:ss'),
      r.foto_path
    ].join(','));
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-ponto.csv"');
  res.send('\uFEFF' + linhas.join('\n'));
});

router.get('/relatorio.pdf', async (req, res) => {
  const { funcionario_id, inicio, fim } = req.query;
  const registros = await db.listarRegistros({ funcionario_id, inicio, fim });
  const funcionarios = await db.listarFuncionarios();
  const nomeDoFuncionario = Object.fromEntries(funcionarios.map(f => [f.id, f.nome]));

  const todasFerias = await db.listarFerias();
  const feriasPorFuncionario = {};
  todasFerias.forEach(f => {
    feriasPorFuncionario[f.funcionario_id] = feriasPorFuncionario[f.funcionario_id] || [];
    feriasPorFuncionario[f.funcionario_id].push(f);
  });
  const estaDeFerias = (fid, diaStr) =>
    (feriasPorFuncionario[fid] || []).some(f => diaStr >= f.data_inicio && diaStr <= f.data_fim);

  // Agrupa por funcionário -> por dia -> { entrada, saida }
  const porFuncionario = {};
  registros.forEach(r => {
    const dia = dayjs(r.timestamp).format('YYYY-MM-DD');
    porFuncionario[r.funcionario_id] = porFuncionario[r.funcionario_id] || {};
    porFuncionario[r.funcionario_id][dia] = porFuncionario[r.funcionario_id][dia] || {};
    porFuncionario[r.funcionario_id][dia][r.tipo] = r.timestamp;
  });

  // Preenche dias de férias dentro do período filtrado (mesmo sem registro de ponto)
  if (inicio && fim) {
    const idsComFerias = funcionario_id ? [funcionario_id] : Object.keys(feriasPorFuncionario);
    idsComFerias.forEach(fid => {
      porFuncionario[fid] = porFuncionario[fid] || {};
      let cursor = dayjs(inicio).startOf('day');
      const limite = dayjs(fim).endOf('day');
      while (cursor.isBefore(limite) || cursor.isSame(limite, 'day')) {
        const diaStr = cursor.format('YYYY-MM-DD');
        if (estaDeFerias(fid, diaStr) && !porFuncionario[fid][diaStr]) {
          porFuncionario[fid][diaStr] = { ferias: true };
        }
        cursor = cursor.add(1, 'day');
      }
    });
  }

  const nomeFiltro = funcionario_id ? (nomeDoFuncionario[funcionario_id] || 'Funcionário') : 'Todos os funcionários';
  const periodoTexto = `${inicio ? dayjs(inicio).format('DD/MM/YYYY') : 'início'} a ${fim ? dayjs(fim).format('DD/MM/YYYY') : 'hoje'}`;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-ponto.pdf"');
  doc.pipe(res);

  const corTitulo = '#1e40af';
  const corTexto = '#374151';
  const corFraco = '#6b7280';
  const corLinha = '#e5e7eb';
  const corFerias = '#1d4ed8';

  // Cabeçalho
  doc.fillColor(corTitulo).fontSize(20).font('Helvetica-Bold').text('Relatório de Ponto', { align: 'left' });
  doc.moveDown(0.2);
  doc.fillColor(corFraco).fontSize(10).font('Helvetica')
    .text(`Funcionário: ${nomeFiltro}`)
    .text(`Período: ${periodoTexto}`)
    .text(`Gerado em: ${dayjs().format('DD/MM/YYYY [às] HH:mm')}`);
  doc.moveDown(0.5);
  doc.strokeColor(corLinha).lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(0.8);

  const idsParaImprimir = funcionario_id ? [funcionario_id] : Object.keys(porFuncionario);

  if (idsParaImprimir.length === 0 || idsParaImprimir.every(fid => Object.keys(porFuncionario[fid] || {}).length === 0)) {
    doc.fillColor(corTexto).fontSize(11).text('Nenhum registro encontrado para o período selecionado.');
  }

  idsParaImprimir.forEach(fid => {
    const dias = porFuncionario[fid];
    if (!dias || Object.keys(dias).length === 0) return;

    if (doc.y > 700) doc.addPage();

    doc.fillColor(corTitulo).fontSize(13).font('Helvetica-Bold').text(nomeDoFuncionario[fid] || 'Funcionário');
    doc.moveDown(0.3);

    // Cabeçalho da tabela
    const colX = { data: 40, entrada: 150, saida: 260, horas: 370, obs: 460 };
    const linhaHeaderY = doc.y;
    doc.fillColor(corFraco).fontSize(9).font('Helvetica-Bold');
    doc.text('DATA', colX.data, linhaHeaderY);
    doc.text('ENTRADA', colX.entrada, linhaHeaderY);
    doc.text('SAÍDA', colX.saida, linhaHeaderY);
    doc.text('HORAS', colX.horas, linhaHeaderY);
    doc.text('STATUS', colX.obs, linhaHeaderY);
    doc.moveDown(0.4);
    doc.strokeColor(corLinha).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.3);

    let totalMinutosFuncionario = 0;
    const minutosPorSemana = {};

    Object.keys(dias).sort().forEach(dia => {
      if (doc.y > 740) { doc.addPage(); }
      const registroDia = dias[dia];

      let horasTexto = '-';
      let status = 'Incompleto';
      let corStatus = '#b45309';
      let entrada = null, saida = null;

      if (registroDia.ferias) {
        status = 'Férias';
        corStatus = corFerias;
      } else {
        entrada = registroDia.entrada ? dayjs(registroDia.entrada) : null;
        saida = registroDia.saida ? dayjs(registroDia.saida) : null;
        if (entrada && saida) {
          const minutos = saida.diff(entrada, 'minute');
          totalMinutosFuncionario += minutos;
          const inicioSemana = dayjs(dia).startOf('isoWeek').format('YYYY-MM-DD');
          minutosPorSemana[inicioSemana] = (minutosPorSemana[inicioSemana] || 0) + minutos;
          const h = Math.floor(minutos / 60);
          const m = minutos % 60;
          horasTexto = `${h}h${String(m).padStart(2, '0')}`;
          status = 'OK';
          corStatus = '#166534';
        }
      }

      const y = doc.y;
      doc.fillColor(corTexto).fontSize(9).font('Helvetica');
      doc.text(dayjs(dia).format('DD/MM/YYYY'), colX.data, y);
      doc.text(entrada ? entrada.format('HH:mm') : '-', colX.entrada, y);
      doc.text(saida ? saida.format('HH:mm') : '-', colX.saida, y);
      doc.text(horasTexto, colX.horas, y);
      doc.fillColor(corStatus).text(status, colX.obs, y);
      doc.moveDown(0.5);
    });

    // Resumo por semana
    const semanasOrdenadas = Object.keys(minutosPorSemana).sort();
    if (semanasOrdenadas.length > 0) {
      if (doc.y > 720) doc.addPage();
      doc.moveDown(0.2);
      doc.fillColor(corFraco).fontSize(9).font('Helvetica-Bold').text('Resumo por semana:', 40, doc.y);
      doc.moveDown(0.2);
      semanasOrdenadas.forEach(inicioSemana => {
        const fimSemana = dayjs(inicioSemana).add(6, 'day').format('DD/MM');
        const min = minutosPorSemana[inicioSemana];
        const texto = `Semana de ${dayjs(inicioSemana).format('DD/MM')} a ${fimSemana}: ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
        doc.fillColor(corTexto).fontSize(9).font('Helvetica').text(texto, 50, doc.y);
        doc.moveDown(0.15);
      });
    }

    const hFunc = Math.floor(totalMinutosFuncionario / 60);
    const mFunc = totalMinutosFuncionario % 60;

    doc.moveDown(0.2);
    doc.strokeColor(corLinha).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.3);
    doc.fillColor(corTitulo).fontSize(10).font('Helvetica-Bold')
      .text(`Total de horas trabalhadas: ${hFunc}h${String(mFunc).padStart(2, '0')}`, 40, doc.y, { align: 'right', width: 515 });
    doc.moveDown(1.2);
  });

  doc.end();
});

module.exports = router;
