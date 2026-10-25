// Módulo de Seguridad y auditoría (R6, RA1, RA5). CU-6.x
const express = require('express');
const { sql } = require('../db/contexto');
const { ruta, tomar, id, exigir } = require('../utils/http');
const P = require('../permisos');

const router = express.Router();

const GESTIONAR = [P.GESTIONAR_SEGURIDAD];
const BITACORA = [P.CONSULTAR_BITACORA];
// Para asignar fontaneros a un mantenimiento hay que poder listar empleados.
const LISTAR_EMPLEADOS = [P.GESTIONAR_SEGURIDAD, P.GESTIONAR_MANTENIMIENTO];

/* ---------------------------- Empleados --------------------------- */

const CAMPOS_EMPLEADO = ['cedula', 'nombre_empleado', 'apellido1_empleado', 'apellido2_empleado', 'puesto', 'telefono'];

// GET /empleados?cedula=&nombre=&puesto=&activo=
router.get('/empleados', ruta(LISTAR_EMPLEADOS, (req, ctx) =>
  ctx.sp('sp_ConsultarEmpleados', tomar(req.query, ['cedula', 'nombre', 'puesto', 'activo']))));

// POST /empleados  CU-6.3
router.post('/empleados', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AgregarEmpleado', tomar(req.body, [...CAMPOS_EMPLEADO, 'fecha_contratacion']),
    { id_empleado: sql.Int }), { estado: 201 }));

// PUT /empleados/:id
router.put('/empleados/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ModificarEmpleado', { id_empleado: id(req.params.id), ...tomar(req.body, CAMPOS_EMPLEADO) })));

// PATCH /empleados/:id/estado  { activo: true|false }
router.patch('/empleados/:id/estado', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_CambiarEstadoEmpleado', { id_empleado: id(req.params.id), ...tomar(exigir(req.body, ['activo']), ['activo']) })));

/* ------------------------ Usuarios del sistema -------------------- */

// GET /usuarios  CU-6.4  Nunca devuelve el hash de la contraseña.
router.get('/usuarios', ruta(GESTIONAR, (_req, ctx) => ctx.lote(`
  SELECT u.id_usuario_sistema, u.nombre_usuario, u.activo, u.intentos_fallidos, u.fecha_ultimo_acceso,
         u.id_rol, r.nombre_rol, u.id_empleado,
         CONCAT_WS(' ', e.nombre_empleado, e.apellido1_empleado, e.apellido2_empleado) AS nombre_empleado,
         e.puesto
  FROM dbo.Usuario_Sistema u
  JOIN dbo.Rol r      ON r.id_rol = u.id_rol
  JOIN dbo.Empleado e ON e.id_empleado = u.id_empleado
  ORDER BY u.nombre_usuario;`)));

// GET /usuarios/bloqueados  Cuentas desactivadas por intentos fallidos.
router.get('/usuarios/bloqueados', ruta(GESTIONAR, (_req, ctx) => ctx.vista('vw_UsuariosBloqueadosPorIntentos')));

// POST /usuarios  { id_empleado, id_rol, nombre_usuario, contrasena }
router.post('/usuarios', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_CrearUsuarioSistema', tomar(req.body, ['id_empleado', 'id_rol', 'nombre_usuario', 'contrasena']),
    { id_usuario_sistema: sql.Int }), { estado: 201 }));

// PUT /usuarios/:id  { id_rol?, id_empleado? }
router.put('/usuarios/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ModificarUsuarioSistema', { id_usuario_sistema: id(req.params.id), ...tomar(req.body, ['id_rol', 'id_empleado']) })));

// PUT /usuarios/:id/contrasena  { nueva }  Restablecimiento por el administrador.
router.put('/usuarios/:id/contrasena', ruta(GESTIONAR, (req, ctx) => {
  const { nueva } = exigir(req.body || {}, ['nueva']);
  return ctx.sp('sp_CambiarContrasenaUsuario', { id_usuario_sistema: id(req.params.id), contrasena_nueva: String(nueva) });
}));

// POST /usuarios/:id/desactivar  y  /usuarios/:id/reactivar (también desbloquea)
router.post('/usuarios/:id/desactivar', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_DesactivarUsuarioSistema', { id_usuario_sistema: id(req.params.id) })));
router.post('/usuarios/:id/reactivar', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ReactivarUsuarioSistema', { id_usuario_sistema: id(req.params.id) })));

// GET /usuarios/:id/permisos
router.get('/usuarios/:id/permisos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ConsultarPermisosUsuario', { id_usuario_sistema: id(req.params.id) })));

/* ------------------------ Roles y permisos ------------------------ */

// GET /roles   POST /roles { nombre_rol }   PUT /roles/:id { nombre_rol }   DELETE /roles/:id
router.get('/roles', ruta(GESTIONAR, (_req, ctx) => ctx.sp('sp_ConsultarRoles')));
router.post('/roles', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarRol', tomar(req.body, ['nombre_rol']), { id_rol: sql.Int }), { estado: 201 }));
router.put('/roles/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarRol', { ...tomar(req.body, ['nombre_rol']), id_rol: id(req.params.id) }, { id_rol: sql.Int })));
router.delete('/roles/:id', ruta(GESTIONAR, (req, ctx) => ctx.sp('sp_EliminarRol', { id_rol: id(req.params.id) })));

// GET /roles/:id/permisos   POST /roles/:id/permisos { id_permiso }   DELETE /roles/:id/permisos/:idPermiso
router.get('/roles/:id/permisos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ConsultarPermisosPorRol', { id_rol: id(req.params.id) })));
router.post('/roles/:id/permisos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AsignarPermisoRol', { id_rol: id(req.params.id), ...tomar(req.body, ['id_permiso']) }), { estado: 201 }));
router.delete('/roles/:id/permisos/:idPermiso', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_QuitarPermisoRol', { id_rol: id(req.params.id), id_permiso: id(req.params.idPermiso, 'id de permiso') })));

// GET /permisos   POST /permisos { id_modulo, nombre_permiso }   PUT /permisos/:id
router.get('/permisos', ruta(GESTIONAR, (_req, ctx) => ctx.sp('sp_ConsultarPermisos')));
router.post('/permisos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarPermiso', tomar(req.body, ['id_modulo', 'nombre_permiso']), { id_permiso: sql.Int }), { estado: 201 }));
router.put('/permisos/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarPermiso', { ...tomar(req.body, ['id_modulo', 'nombre_permiso']), id_permiso: id(req.params.id) },
    { id_permiso: sql.Int })));

// GET /modulos   POST /modulos { nombre_modulo }   PUT /modulos/:id   GET /modulos/:id/permisos
router.get('/modulos', ruta(GESTIONAR, (_req, ctx) => ctx.sp('sp_ConsultarModulos')));
router.post('/modulos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarModulo', tomar(req.body, ['nombre_modulo']), { id_modulo: sql.Int }), { estado: 201 }));
router.put('/modulos/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarModulo', { ...tomar(req.body, ['nombre_modulo']), id_modulo: id(req.params.id) }, { id_modulo: sql.Int })));
router.get('/modulos/:id/permisos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ConsultarPermisosPorModulo', { id_modulo: id(req.params.id) })));

/* ---------------------------- Bitácora ---------------------------- */

// GET /bitacora?id_usuario_sistema=&accion=&tabla_afectada=&desde=&hasta=  CU-6.7
router.get('/bitacora', ruta(BITACORA, (req, ctx) =>
  ctx.sp('sp_ConsultarBitacora', tomar(req.query, ['id_usuario_sistema', 'accion', 'tabla_afectada', 'desde', 'hasta']))));

// GET /bitacora/reciente
router.get('/bitacora/reciente', ruta(BITACORA, (_req, ctx) => ctx.vista('vw_BitacoraReciente')));

// GET /bitacora/resumen?desde=&hasta=  Actividad por usuario.
router.get('/bitacora/resumen', ruta(BITACORA, (req, ctx) =>
  ctx.sp('sp_ResumirActividadUsuarios', tomar(exigir(req.query, ['desde', 'hasta']), ['desde', 'hasta']))));

module.exports = router;
