const { ErrorApi } = require('../utils/http');

// El driver ODBC antepone "[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]".
function limpiarMensaje(mensaje = '') {
  return mensaje.replace(/^(\[[^\]]*\])+\s*/, '');
}

function numeroSql(err) {
  if (err.number != null) return Number(err.number);
  if (err.originalError?.info?.number != null) return Number(err.originalError.info.number);
  if (err.originalError?.number != null) return Number(err.originalError.number);
  if (Array.isArray(err.precedingErrors) && err.precedingErrors.length > 0) {
    for (const pe of err.precedingErrors) {
      const num = pe.number ?? pe.originalError?.info?.number;
      if (num != null) return Number(num);
    }
  }
  const match = String(err.message || '').match(/(?:Error|THROW|código)\s*:?\s*(5\d{4})/i);
  if (match) return Number(match[1]);
  return null;
}

// Traduce errores de SQL Server a respuestas HTTP bien estructuradas (422 / 400 para reglas de negocio).
// Convención de los scripts: THROW 5xxxx con mensaje en español para reglas de negocio.
function traducir(err) {
  if (err instanceof ErrorApi) return { estado: err.estado, mensaje: err.message };
  if (err.type === 'entity.parse.failed') return { estado: 400, mensaje: 'El cuerpo de la petición no es un JSON válido.' };

  const numero = numeroSql(err);
  const mensaje = limpiarMensaje(err.message);

  if (numero === 50401) return { estado: 401, mensaje, codigo: numero };
  if (numero === 50403) return { estado: 403, mensaje, codigo: numero };

  // Reglas de negocio personalizadas de la ASADA (THROW 50000 - 59999) -> 422 Unprocessable Entity
  if (numero >= 50000 && numero <= 59999) {
    return { estado: 422, mensaje, codigo: numero, tipo: 'regla_negocio' };
  }

  switch (numero) {
    case 201:   // falta un parámetro obligatorio del procedimiento
      return { estado: 400, mensaje: `Falta un dato obligatorio: ${mensaje.match(/'@(\w+)'/)?.[1] ?? mensaje}.` };
    case 245: case 8114: case 241: case 242: case 8115: case 220:
      return { estado: 400, mensaje: 'Uno de los valores no tiene el formato correcto (número o fecha).' };
    case 2627: case 2601:
      return { estado: 409, mensaje: 'Ya existe un registro con esos datos.' };
    case 547:
      return { estado: 409, mensaje: 'La operación viola una regla de integridad de la base de datos.', detalle: mensaje };
    case 8152: case 2628:
      return { estado: 400, mensaje: 'Uno de los textos es más largo de lo permitido.' };
    default:
      if (mensaje && !/syntax error|invalid object|server is not found|stack trace|timeout/i.test(mensaje) && !mensaje.includes('node:internal')) {
        return { estado: 400, mensaje, tipo: 'validacion' };
      }
      return null;
  }
}

// eslint-disable-next-line no-unused-vars
function manejarErrores(err, req, res, _next) {
  const traducido = traducir(err);
  if (!traducido) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
  const { estado, ...cuerpo } = traducido;
  res.status(estado).json({ ok: false, ...cuerpo });
}

function noEncontrado(req, res) {
  res.status(404).json({ ok: false, mensaje: `No existe la ruta ${req.method} ${req.originalUrl}.` });
}

module.exports = { manejarErrores, noEncontrado };
