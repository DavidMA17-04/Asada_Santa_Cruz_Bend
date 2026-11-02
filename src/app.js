const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { obtenerPool } = require('./db/conexion');
const { autenticar } = require('./middleware/autenticacion');
const { manejarErrores, noEncontrado } = require('./middleware/errores');

const app = express();

app.disable('x-powered-by');

// Encabezados básicos de seguridad para la API y el front que se sirve desde aquí.
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});
app.use(cors({ origin: config.corsOrigen === '*' ? true : config.corsOrigen.split(',').map((o) => o.trim()) }));
app.use(express.json({ limit: '100kb' }));

// GET /api/salud  Verifica que la API y la base respondan (sin sesión).
app.get('/api/salud', async (_req, res, next) => {
  try {
    const pool = await obtenerPool();
    const r = await pool.request().query('SELECT DB_NAME() AS base, SYSDATETIME() AS hora_servidor;');
    res.json({ ok: true, ...r.recordset[0] });
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', require('./rutas/auth'));

// A partir de aquí todas las rutas exigen sesión.
const api = express.Router();
api.use(autenticar);
api.use(require('./rutas/usuarios-conexiones'));
api.use(require('./rutas/lecturas-facturacion'));
api.use(require('./rutas/pagos-morosidad'));
api.use(require('./rutas/mantenimientos-incidencias'));
api.use('/seguridad', require('./rutas/seguridad'));
api.use('/catalogos', require('./rutas/catalogos'));
api.use(require('./rutas/administracion'));
app.use('/api', api);

// Front web: el build de React (../frontend/dist, se genera con "npm run build"),
// servido en la raíz y en el mismo origen que la API.
app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'dist')));

app.use(noEncontrado);
app.use(manejarErrores);

module.exports = app;
