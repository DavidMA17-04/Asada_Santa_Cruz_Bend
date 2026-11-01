/* Límite de intentos fallidos de inicio de sesión por dirección IP.

   La base ya bloquea una cuenta después de 3 contraseñas incorrectas
   (sp_RegistrarIntentoFallido), pero eso no frena a quien prueba muchos
   nombres de usuario distintos desde el mismo equipo. Aquí se cuentan los
   fallos por IP en una ventana de tiempo; al pasar el límite se responde 429
   hasta que la ventana termine. Un inicio de sesión correcto reinicia el conteo. */
const { ErrorApi } = require('../utils/http');

const MAXIMO_FALLOS = Number(process.env.LOGIN_MAX_FALLOS || 10);
const VENTANA_MS = Number(process.env.LOGIN_VENTANA_MIN || 15) * 60 * 1000;

const fallos = new Map();   // ip -> { cantidad, desde }

function vigente(registro, ahora) {
  return registro && ahora - registro.desde < VENTANA_MS;
}

function claveDe(req) {
  return req.ip || req.socket?.remoteAddress || 'desconocida';
}

// Middleware: rechaza la petición si la IP ya agotó sus intentos.
function verificarIntentos(req, _res, next) {
  const registro = fallos.get(claveDe(req));
  const ahora = Date.now();
  if (vigente(registro, ahora) && registro.cantidad >= MAXIMO_FALLOS) {
    const minutos = Math.ceil((VENTANA_MS - (ahora - registro.desde)) / 60000);
    return next(new ErrorApi(429, `Demasiados intentos fallidos. Intente de nuevo en ${minutos} minuto(s).`));
  }
  next();
}

function registrarFallo(req) {
  const clave = claveDe(req);
  const ahora = Date.now();
  const registro = fallos.get(clave);
  if (vigente(registro, ahora)) {
    registro.cantidad += 1;
  } else {
    fallos.set(clave, { cantidad: 1, desde: ahora });
  }
  // Limpieza simple para que el mapa no crezca sin control.
  if (fallos.size > 5000) {
    for (const [ip, r] of fallos) if (!vigente(r, ahora)) fallos.delete(ip);
  }
}

function reiniciarIntentos(req) {
  fallos.delete(claveDe(req));
}

module.exports = { verificarIntentos, registrarFallo, reiniciarIntentos, MAXIMO_FALLOS };
