require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const employeeRoutes = require('./routes/employee');
const adminRoutes = require('./routes/admin');
const { UPLOADS_DIR } = require('./storage');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' })); // fotos em base64 podem ser grandes
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-este-segredo-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 horas
}));

// Arquivos estáticos (frontend e fotos salvas localmente)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// API
app.use('/api/ponto', employeeRoutes);
app.use('/api/admin', adminRoutes);

// Páginas
app.get('/ponto/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ponto.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});
app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});
app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.listen(PORT, async () => {
  await db.migrar();
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
