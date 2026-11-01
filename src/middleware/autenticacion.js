const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { ErrorApi } = require('../utils/http');

// Solo se acepta el algoritmo con el que se firma, para que no se pueda
// presentar un token firmado con otro algoritmo.
const ALGORITMO = 'HS256';

// CU-6.2: tokens cerrados con logout. Se guardan hasta que vencen por sí solos.
// Vive en memoria: al reiniciar la API la lista se pierde, pero el token
// igual vence según JWT_EXPIRA.
const revocados = new Map();

function limpiarRevocados() {
  const ahora = Math.floor(Date.now() / 1000);
  for (const [jti, expira] of revocados) {
    if (expira <= ahora) revocados.delete(jti);
  }
}

function revocarToken(jti, expira) {
  if (!jti) return;
  limpiarRevocados();
  revocados.set(jti, expira);
}

function firmarToken(usuario) {
  return jwt.sign(
    { emp: usuario.id_empleado, usuario: usuario.nombre_usuario, rol: usuario.nombre_rol },
    config.jwt.secreto,
    {
      algorithm: ALGORITMO,
      subject: String(usuario.id_usuario_sistema),
      jwtid: crypto.randomUUID(),
      expiresIn: config.jwt.expira,
    },
  );
}

// Exige "Authorization: Bearer <token>". Los permisos NO se toman del token:
// se verifican en la base en cada petición (ver db/contexto.js).
function autenticar(req, _res, next) {
  const [esquema, token] = (req.headers.authorization || '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    return next(new ErrorApi(401, 'Debe iniciar sesión.'));
  }
  let datos;
  try {
    datos = jwt.verify(token, config.jwt.secreto, { algorithms: [ALGORITMO] });
  } catch {
    return next(new ErrorApi(401, 'La sesión expiró o el token no es válido. Inicie sesión de nuevo.'));
  }
  if (datos.jti && revocados.has(datos.jti)) {
    return next(new ErrorApi(401, 'La sesión fue cerrada. Inicie sesión de nuevo.'));
  }
  req.usuario = {
    id_usuario_sistema: Number(datos.sub),
    id_empleado: datos.emp,
    nombre_usuario: datos.usuario,
    nombre_rol: datos.rol,
    jti: datos.jti,
    expira: datos.exp,
  };
  next();
}

module.exports = { firmarToken, autenticar, revocarToken };
