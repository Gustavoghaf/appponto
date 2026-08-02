let funcionariosCache = [];

async function verificarLogin() {
  const resp = await fetch('/api/admin/me');
  const dados = await resp.json();
  if (!dados.logado) window.location.href = '/admin';
}

async function carregarFuncionarios() {
  const resp = await fetch('/api/admin/funcionarios');
  funcionariosCache = await resp.json();

  const tbody = document.getElementById('tabela-funcionarios');
  tbody.innerHTML = funcionariosCache.map(f => `
    <tr>
      <td>${f.nome}</td>
      <td>${f.cargo || '-'}</td>
      <td><span class="badge ${f.status === 'ativo' ? 'badge-ativo' : 'badge-inativo'}">${f.status}</span></td>
      <td class="flex">
        <button class="btn-secundario" style="padding:6px 10px;" onclick="abrirQr('${f.id}')">QR / Link</button>
        <button class="btn-secundario" style="padding:6px 10px;" onclick="editarFuncionario('${f.id}')">Editar</button>
        <button class="${f.status === 'ativo' ? 'btn-perigo' : 'btn-sucesso'}" style="padding:6px 10px;" onclick="alternarStatus('${f.id}', '${f.status}')">
          ${f.status === 'ativo' ? 'Desativar' : 'Ativar'}
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="texto-fraco">Nenhum funcionário cadastrado ainda.</td></tr>';

  const opcoes = funcionariosCache.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
  document.getElementById('filtro-funcionario').innerHTML = '<option value="">Todos</option>' + opcoes;
  document.getElementById('r-funcionario').innerHTML = opcoes;
  document.getElementById('fe-funcionario').innerHTML = opcoes;
}

// ---------- Modal funcionário ----------

function abrirModalNovo() {
  document.getElementById('modal-titulo').textContent = 'Novo funcionário';
  document.getElementById('f-id').value = '';
  document.getElementById('f-nome').value = '';
  document.getElementById('f-cargo').value = '';
  document.getElementById('f-pin').value = '';
  document.getElementById('f-pin').placeholder = 'Ex: 1234';
  document.getElementById('modal-msg').innerHTML = '';
  document.getElementById('modal-funcionario').classList.add('aberto');
}

function editarFuncionario(id) {
  const f = funcionariosCache.find(x => x.id === id);
  document.getElementById('modal-titulo').textContent = 'Editar funcionário';
  document.getElementById('f-id').value = f.id;
  document.getElementById('f-nome').value = f.nome;
  document.getElementById('f-cargo').value = f.cargo || '';
  document.getElementById('f-pin').value = '';
  document.getElementById('f-pin').placeholder = 'Deixe em branco para não alterar';
  document.getElementById('modal-msg').innerHTML = '';
  document.getElementById('modal-funcionario').classList.add('aberto');
}

function fecharModalFuncionario() {
  document.getElementById('modal-funcionario').classList.remove('aberto');
}

async function salvarFuncionario() {
  const id = document.getElementById('f-id').value;
  const nome = document.getElementById('f-nome').value.trim();
  const cargo = document.getElementById('f-cargo').value.trim();
  const pin = document.getElementById('f-pin').value.trim();
  const msg = document.getElementById('modal-msg');

  if (!nome) { msg.innerHTML = '<div class="erro">Informe o nome.</div>'; return; }
  if (!id && !pin) { msg.innerHTML = '<div class="erro">Informe o PIN.</div>'; return; }

  const url = id ? `/api/admin/funcionarios/${id}` : '/api/admin/funcionarios';
  const method = id ? 'PUT' : 'POST';
  const body = { nome, cargo };
  if (pin) body.pin = pin;

  const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const dados = await resp.json();

  if (!resp.ok) { msg.innerHTML = `<div class="erro">${dados.erro}</div>`; return; }

  fecharModalFuncionario();
  await carregarFuncionarios();

  if (!id) abrirQr(dados.id); // já mostra o QR ao criar
}

async function alternarStatus(id, statusAtual) {
  const novoStatus = statusAtual === 'ativo' ? 'inativo' : 'ativo';
  await fetch(`/api/admin/funcionarios/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: novoStatus })
  });
  await carregarFuncionarios();
}

// ---------- QR code ----------

async function abrirQr(id) {
  const f = funcionariosCache.find(x => x.id === id) || (await (await fetch('/api/admin/funcionarios')).json()).find(x => x.id === id);
  const resp = await fetch(`/api/admin/funcionarios/${id}/qrcode`);
  const dados = await resp.json();

  document.getElementById('qr-nome').textContent = f ? f.nome : '';
  document.getElementById('qr-img').src = dados.qrDataUrl;
  document.getElementById('qr-img').dataset.qr = dados.qrDataUrl;
  document.getElementById('qr-img').dataset.nome = f ? f.nome : 'funcionario';
  document.getElementById('qr-link').textContent = dados.link;
  document.getElementById('qr-link').dataset.link = dados.link;
  document.getElementById('modal-qr').classList.add('aberto');
}

function fecharModalQr() {
  document.getElementById('modal-qr').classList.remove('aberto');
}

// ---------- Registros / relatórios ----------

function montarQuery() {
  const funcionario_id = document.getElementById('filtro-funcionario').value;
  const inicio = document.getElementById('filtro-inicio').value;
  const fim = document.getElementById('filtro-fim').value;
  const params = new URLSearchParams();
  if (funcionario_id) params.set('funcionario_id', funcionario_id);
  if (inicio) params.set('inicio', new Date(inicio + 'T00:00:00').toISOString());
  if (fim) params.set('fim', new Date(fim + 'T23:59:59').toISOString());
  return params.toString();
}

async function carregarRegistros() {
  const resp = await fetch(`/api/admin/registros?${montarQuery()}`);
  const registros = await resp.json();
  const nomes = Object.fromEntries(funcionariosCache.map(f => [f.id, f.nome]));

  const tbody = document.getElementById('tabela-registros');
  tbody.innerHTML = registros.map(r => {
    const dt = new Date(r.timestamp);
    return `
      <tr>
        <td>${nomes[r.funcionario_id] || '-'}</td>
        <td><span class="badge ${r.tipo === 'entrada' ? 'badge-entrada' : 'badge-saida'}">${r.tipo}</span></td>
        <td>${dt.toLocaleDateString('pt-BR')}</td>
        <td>${dt.toLocaleTimeString('pt-BR')}</td>
        <td>${r.foto_path ? `<a href="${r.foto_path}" target="_blank">ver foto</a>` : '-'}</td>
        <td>${r.origem === 'admin' ? '<span class="badge badge-inativo">corrigido</span>' : '<span class="texto-fraco">funcionário</span>'}</td>
        <td class="flex">
          <button class="btn-secundario" style="padding:4px 8px; font-size:12px;" onclick="abrirModalRegistro('${r.id}')">Editar</button>
          <button class="btn-perigo" style="padding:4px 8px; font-size:12px;" onclick="excluirRegistro('${r.id}')">Excluir</button>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" class="texto-fraco">Nenhum registro no período.</td></tr>';

  await atualizarResumo();
}

async function atualizarResumo() {
  const funcionario_id = document.getElementById('filtro-funcionario').value;
  const bloco = document.getElementById('resumo-horas');
  if (!funcionario_id) { bloco.style.display = 'none'; return; }

  const resp = await fetch(`/api/admin/resumo/${funcionario_id}`);
  if (!resp.ok) { bloco.style.display = 'none'; return; }
  const dados = await resp.json();
  document.getElementById('resumo-hoje').textContent = dados.horasHoje;
  document.getElementById('resumo-semana').textContent = dados.horasSemana;
  bloco.style.display = 'block';
}

function exportarCsv() {
  window.location.href = `/api/admin/relatorio.csv?${montarQuery()}`;
}

function exportarPdf() {
  window.location.href = `/api/admin/relatorio.pdf?${montarQuery()}`;
}

function baixarQrCode() {
  const img = document.getElementById('qr-img');
  const link = document.createElement('a');
  link.href = img.dataset.qr;
  const nomeArquivo = (img.dataset.nome || 'funcionario').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  link.download = `qrcode-${nomeArquivo}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ---------- Correção / inserção manual de registro ----------

function paraDatetimeLocal(isoString) {
  const dt = new Date(isoString);
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function abrirModalRegistroNovo() {
  document.getElementById('registro-titulo').textContent = 'Inserir registro (esquecimento)';
  document.getElementById('r-id').value = '';
  document.getElementById('r-funcionario').disabled = false;
  const filtro = document.getElementById('filtro-funcionario').value;
  if (filtro) document.getElementById('r-funcionario').value = filtro;
  document.getElementById('r-tipo').value = 'entrada';
  document.getElementById('r-datahora').value = paraDatetimeLocal(new Date().toISOString());
  document.getElementById('registro-msg').innerHTML = '';
  document.getElementById('modal-registro').classList.add('aberto');
}

async function abrirModalRegistro(id) {
  const resp = await fetch(`/api/admin/registros?${montarQuery()}`);
  const registros = await resp.json();
  const r = registros.find(x => x.id === id);
  if (!r) return;

  document.getElementById('registro-titulo').textContent = 'Corrigir registro';
  document.getElementById('r-id').value = r.id;
  document.getElementById('r-funcionario').value = r.funcionario_id;
  document.getElementById('r-funcionario').disabled = true; // não muda o dono do registro, só horário/tipo
  document.getElementById('r-tipo').value = r.tipo;
  document.getElementById('r-datahora').value = paraDatetimeLocal(r.timestamp);
  document.getElementById('registro-msg').innerHTML = '';
  document.getElementById('modal-registro').classList.add('aberto');
}

function fecharModalRegistro() {
  document.getElementById('modal-registro').classList.remove('aberto');
}

async function salvarRegistro() {
  const id = document.getElementById('r-id').value;
  const funcionario_id = document.getElementById('r-funcionario').value;
  const tipo = document.getElementById('r-tipo').value;
  const datahora = document.getElementById('r-datahora').value;
  const msg = document.getElementById('registro-msg');

  if (!funcionario_id) { msg.innerHTML = '<div class="erro">Selecione o funcionário.</div>'; return; }
  if (!datahora) { msg.innerHTML = '<div class="erro">Informe a data e hora.</div>'; return; }

  const timestamp = new Date(datahora).toISOString();
  const url = id ? `/api/admin/registros/${id}` : '/api/admin/registros';
  const method = id ? 'PUT' : 'POST';
  const body = id ? { tipo, timestamp } : { funcionario_id, tipo, timestamp };

  const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const dados = await resp.json();
  if (!resp.ok) { msg.innerHTML = `<div class="erro">${dados.erro}</div>`; return; }

  fecharModalRegistro();
  await carregarRegistros();
}

async function excluirRegistro(id) {
  if (!confirm('Excluir este registro? Essa ação não pode ser desfeita.')) return;
  await fetch(`/api/admin/registros/${id}`, { method: 'DELETE' });
  await carregarRegistros();
}

// ---------- Férias ----------

async function carregarFerias() {
  const resp = await fetch('/api/admin/ferias');
  const ferias = await resp.json();
  const nomes = Object.fromEntries(funcionariosCache.map(f => [f.id, f.nome]));

  const tbody = document.getElementById('tabela-ferias');
  tbody.innerHTML = ferias.map(f => `
    <tr>
      <td>${nomes[f.funcionario_id] || '-'}</td>
      <td>${new Date(f.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${new Date(f.data_fim + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${f.observacao || '-'}</td>
      <td><button class="btn-perigo" style="padding:4px 8px; font-size:12px;" onclick="excluirFerias('${f.id}')">Excluir</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="texto-fraco">Nenhuma férias registrada.</td></tr>';
}

function abrirModalFerias() {
  document.getElementById('fe-inicio').value = '';
  document.getElementById('fe-fim').value = '';
  document.getElementById('fe-obs').value = '';
  document.getElementById('ferias-msg').innerHTML = '';
  document.getElementById('modal-ferias').classList.add('aberto');
}

function fecharModalFerias() {
  document.getElementById('modal-ferias').classList.remove('aberto');
}

async function salvarFerias() {
  const funcionario_id = document.getElementById('fe-funcionario').value;
  const data_inicio = document.getElementById('fe-inicio').value;
  const data_fim = document.getElementById('fe-fim').value;
  const observacao = document.getElementById('fe-obs').value.trim();
  const msg = document.getElementById('ferias-msg');

  if (!funcionario_id || !data_inicio || !data_fim) {
    msg.innerHTML = '<div class="erro">Preencha funcionário, início e fim.</div>';
    return;
  }

  const resp = await fetch('/api/admin/ferias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ funcionario_id, data_inicio, data_fim, observacao })
  });
  const dados = await resp.json();
  if (!resp.ok) { msg.innerHTML = `<div class="erro">${dados.erro}</div>`; return; }

  fecharModalFerias();
  await carregarFerias();
}

async function excluirFerias(id) {
  if (!confirm('Excluir este período de férias?')) return;
  await fetch(`/api/admin/ferias/${id}`, { method: 'DELETE' });
  await carregarFerias();
}

// ---------- Inicialização ----------

document.getElementById('btn-sair').onclick = async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin';
};
document.getElementById('btn-novo').onclick = abrirModalNovo;
document.getElementById('btn-modal-cancelar').onclick = fecharModalFuncionario;
document.getElementById('btn-modal-salvar').onclick = salvarFuncionario;
document.getElementById('btn-fechar-qr').onclick = fecharModalQr;
document.getElementById('btn-copiar-link').onclick = () => {
  navigator.clipboard.writeText(document.getElementById('qr-link').dataset.link);
  alert('Link copiado!');
};
document.getElementById('btn-filtrar').onclick = carregarRegistros;
document.getElementById('btn-exportar-csv').onclick = exportarCsv;
document.getElementById('btn-exportar-pdf').onclick = exportarPdf;
document.getElementById('btn-baixar-qr').onclick = baixarQrCode;
document.getElementById('btn-registro-manual').onclick = abrirModalRegistroNovo;
document.getElementById('btn-registro-cancelar').onclick = fecharModalRegistro;
document.getElementById('btn-registro-salvar').onclick = salvarRegistro;
document.getElementById('btn-nova-ferias').onclick = abrirModalFerias;
document.getElementById('btn-ferias-cancelar').onclick = fecharModalFerias;
document.getElementById('btn-ferias-salvar').onclick = salvarFerias;

(async () => {
  await verificarLogin();
  await carregarFuncionarios();
  await carregarRegistros();
  await carregarFerias();
})();
