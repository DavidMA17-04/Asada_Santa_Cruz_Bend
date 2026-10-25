const jwt = require('jsonwebtoken');
const config = require('../config');
const { ErrorApi } = require('../utils/http');

function firmarToken(usuario) {
  return jwt.sign(
    { emp: usuario.id_empleado, usuario: usuario.nombre_usuario, rol: usuario.nombre_rol },
    config.jwt.secreto,
    { subject: String(usuario.id_usuario_sistema), expiresIn: config.jwt.expira },
  );
}

// Exige "Authorization: Bearer <token>". Los permisos NO se toman del token:
// se verifican en la base en cada petición (ver db/contexto.js).
function autenticar(req, _res, next) {
  const [esquema, token] = (req.headers.authorization || '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    return next(new ErrorApi(401, 'Debe iniciar sesión.'));
  }
  try {
    const datos = jwt.verify(token, config.jwt.secreto);
    req.usuario = {
      id_usuario_sistema: Number(datos.sub),
      id_empleado: datos.emp,
      nombre_usuario: datos.usuario,
      nombre_rol: datos.rol,
    };
    next();
  } catch {
    next(new ErrorApi(401, 'La sesión expiró o el token no es válido. Inicie sesión de nuevo.'));
  }
}

module.exports = { firmarToken, autenticar };
