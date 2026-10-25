require('dotenv').config({ quiet: true });

function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}. Copie .env.example a .env y complétela.`);
  }
  return valor;
}

const autenticacion = (process.env.DB_AUTENTICACION || 'windows').toLowerCase();

const config = {
  puerto: Number(process.env.PUERTO || 3000),
  corsOrigen: process.env.CORS_ORIGEN || '*',
  permitirPruebas: process.env.PERMITIR_PRUEBAS === 'true',
  jwt: {
    secreto: requerida('JWT_SECRETO'),
    expira: process.env.JWT_EXPIRA || '8h',
  },
  db: {
    servidor: process.env.DB_SERVIDOR || 'localhost',
    base: process.env.DB_BASE || 'ASADA',
    baseDW: process.env.DB_BASE_DW || 'ASADA_DW',
    driver: process.env.DB_DRIVER || 'ODBC Driver 18 for SQL Server',
    autenticacion,
    usuario: autenticacion === 'sql' ? requerida('DB_USUARIO') : null,
    contrasena: autenticacion === 'sql' ? requerida('DB_CONTRASENA') : null,
    // Respaldos, restauraciones y el ETL pueden tardar varios minutos.
    timeoutMs: Number(process.env.DB_TIMEOUT_MS || 300000),
  },
};

if (!/^\w+$/.test(config.db.baseDW)) {
  throw new Error('DB_BASE_DW solo puede contener letras, números y guion bajo.');
}

module.exports = config;
