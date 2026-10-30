const os = require('os');
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
    // Direcciones para entrar desde otras computadoras (misma red, Tailscale, Hamachi…).
    for (const [nombre, direcciones] of Object.entries(os.networkInterfaces())) {
      if (/vmware|virtualbox|vethernet|wsl|docker/i.test(nombre)) continue; // redes virtuales locales
      for (const d of direcciones) {
        if (d.family === 'IPv4' && !d.internal) console.log(`  Desde otra compu (${nombre}): http://${d.address}:${config.puerto}/`);
      }
    }
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
