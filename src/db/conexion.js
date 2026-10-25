/* Capa de acceso a datos: pool de conexiones a SQL Server.
   Se usa el driver msnodesqlv8 (ODBC) porque permite autenticación de Windows. */
const sql = require('mssql/msnodesqlv8');
const config = require('../config');

function cadenaConexion() {
  const { driver, servidor, base, autenticacion, usuario, contrasena } = config.db;
  const credenciales = autenticacion === 'sql'
    ? `UID=${usuario};PWD={${contrasena.replace(/}/g, '}}')}};`
    : 'Trusted_Connection=yes;';
  return `Driver={${driver}};Server=${servidor};Database=${base};${credenciales}TrustServerCertificate=yes;`;
}

let poolPromesa = null;

function obtenerPool() {
  if (!poolPromesa) {
    poolPromesa = new sql.ConnectionPool({
      connectionString: cadenaConexion(),
      requestTimeout: config.db.timeoutMs,
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    }).connect().catch((err) => {
      poolPromesa = null;
      throw err;
    });
  }
  return poolPromesa;
}

async function cerrarPool() {
  if (poolPromesa) {
    const pool = await poolPromesa;
    poolPromesa = null;
    await pool.close();
  }
}

module.exports = { sql, obtenerPool, cerrarPool };
