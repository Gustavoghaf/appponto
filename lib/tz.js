// lib/tz.js
// Fonte única do fuso horário do app. O servidor (Render) roda com o
// relógio em UTC, então qualquer formatação/comparação de data que não
// passar por aqui fica 3h errada (ou agrupa o dia errado) em relação ao
// horário de Brasília.

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'America/Sao_Paulo';

module.exports = { dayjs, TZ };
