const config = require('./config');
const app = require('./app');
const { obtenerPool, cerrarPool } = require('./db/conexion');

async function iniciar() {
  try {
    await obtenerPool();
    console.log(`Conectado a SQL Server: ${config.db.servidor} / ${config.db.base}`);
  } catch (err) {
    console.error('No se pudo conectar a SQL Server. Revise DB_* en .env.\n', err.message);
    process.exit(1);
  }

  const servidor = app.listen(config.puerto, () => {
    console.log(`API ASADA escuchando en http://localhost:${config.puerto}/api`);
  });

  const apagar = async () => {
    servidor.close();
    await cerrarPool();
    process.exit(0);
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
}

iniciar();
