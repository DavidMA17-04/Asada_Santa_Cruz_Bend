// CU-1.1 / CU-6.1 Iniciar sesión, CU-6.2 Cerrar sesión.
const express = require('express');
const { sql, obtenerPool } = require('../db/conexion');
const { firmarToken, autenticar, revocarToken } = require('../middleware/autenticacion');
const { verificarIntentos, registrarFallo, reiniciarIntentos } = require('../middleware/limiteIntentos');
const { ErrorApi, ruta, exigir } = require('../utils/http');

const router = express.Router();

const PERMISOS_USUARIO = `
SELECT m.nombre_modulo, p.nombre_permiso
FROM dbo.Usuario_Sistema u
JOIN dbo.Rol_permiso rp ON rp.id_rol = u.id_rol
JOIN dbo.Permiso p      ON p.id_permiso = rp.id_permiso
JOIN dbo.Modulo m       ON m.id_modulo = p.id_modulo
WHERE u.id_usuario_sistema = @id_usuario_sistema
ORDER BY m.nombre_modulo, p.nombre_permiso;`;

const DATOS_USUARIO = `
SELECT u.id_usuario_sistema, u.id_empleado, u.nombre_usuario, r.id_rol, r.nombre_rol,
       CONCAT_WS(' ', e.nombre_empleado, e.apellido1_empleado, e.apellido2_empleado) AS nombre_empleado,
       e.puesto, u.fecha_ultimo_acceso
FROM dbo.Usuario_Sistema u
JOIN dbo.Rol r      ON r.id_rol = u.id_rol
JOIN dbo.Empleado e ON e.id_empleado = u.id_empleado
WHERE u.id_usuario_sistema = @id_usuario_sistema;`;

function formatearPerfil(filasUsuario, filasPermisos) {
  return { ...filasUsuario[0], permisos: filasPermisos.map((p) => p.nombre_permiso), detalle_permisos: filasPermisos };
}

// POST /api/auth/login  { usuario, contrasena }  CU-6.1
// Antes de consultar la base se revisa el límite de intentos fallidos por IP.
router.post('/login', verificarIntentos, async (req, res, next) => {
  try {
    const { usuario, contrasena } = exigir(req.body || {}, ['usuario', 'contrasena']);
    if (typeof usuario !== 'string' || typeof contrasena !== 'string') {
      throw new ErrorApi(400, 'Usuario y contraseña deben ser texto.');
    }

    const pool = await obtenerPool();
    const r = await pool.request()
      .input('nombre_usuario', sql.VarChar(50), usuario)
      .input('contrasena', sql.NVarChar(128), contrasena)
      .output('id_usuario_sistema', sql.Int)
      .output('resultado', sql.VarChar(30))
      .query(`
        EXEC dbo.sp_IniciarSesion @nombre_usuario = @nombre_usuario, @contrasena = @contrasena,
             @id_usuario_sistema = @id_usuario_sistema OUTPUT, @resultado = @resultado OUTPUT;
        IF @resultado = 'OK'
        BEGIN
          ${DATOS_USUARIO}
          ${PERMISOS_USUARIO}
        END`);

    const { resultado } = r.output;
    if (resultado !== 'OK') registrarFallo(req);
    if (resultado === 'USUARIO_BLOQUEADO') {
      throw new ErrorApi(403, 'El usuario está bloqueado o inactivo. Contacte al administrador.');
    }
    if (resultado !== 'OK') {
      throw new ErrorApi(401, 'Usuario o contraseña incorrectos.');
    }

    reiniciarIntentos(req);
    const perfil = formatearPerfil(r.recordsets[0], r.recordsets[1]);
    res.json({ ok: true, token: firmarToken(perfil), usuario: perfil });
  } catch (err) {
    next(err);
  }
});

router.use(autenticar);

// GET /api/auth/perfil  Datos y permisos actuales del usuario.
router.get('/perfil', ruta([], async (req, ctx) => {
  const r = await ctx.lote(DATOS_USUARIO + PERMISOS_USUARIO,
    { id_usuario_sistema: req.usuario.id_usuario_sistema });
  return { datos: formatearPerfil(r.conjuntos?.[0] ?? r.datos, r.conjuntos?.[1] ?? []) };
}));

// POST /api/auth/logout  CU-6.2  Registra el cierre en la bitácora e invalida el token,
// así no sirve aunque alguien lo haya copiado antes de cerrar la sesión.
router.post('/logout', ruta([], async (req, ctx) => {
  const r = await ctx.sp('sp_CerrarSesion');
  revocarToken(req.usuario.jti, req.usuario.expira);
  return r;
}));

// PUT /api/auth/contrasena  { actual, nueva }
router.put('/contrasena', ruta([], (req, ctx) => {
  const { actual, nueva } = exigir(req.body || {}, ['actual', 'nueva']);
  return ctx.sp('sp_CambiarContrasenaUsuario', {
    id_usuario_sistema: req.usuario.id_usuario_sistema,
    contrasena_nueva: String(nueva),
    contrasena_actual: String(actual),
  });
}));

module.exports = router;
