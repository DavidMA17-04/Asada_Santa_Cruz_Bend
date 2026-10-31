// Módulo de Seguridad y auditoría (R6, RA1, RA5). CU-6.x
const express = require('express');
const { sql } = require('../db/contexto');
const { ErrorApi, ruta, tomar, id, exigir } = require('../utils/http');
const P = require('../permisos');

const router = express.Router();

const GESTIONAR = [P.GESTIONAR_SEGURIDAD];
const BITACORA = [P.CONSULTAR_BITACORA];
// Para asignar fontaneros a un mantenimiento hay que poder listar empleados.
const LISTAR_EMPLEADOS = [P.GESTIONAR_SEGURIDAD, P.GESTIONAR_MANTENIMIENTO];

/* ---------------------------- Empleados --------------------------- */

// Evita que el administrador se quede sin acceso por error: no puede desactivar
// su propio empleado (sp_CambiarEstadoEmpleado también desactiva su usuario).
const NO_EMPLEADO_PROPIO = `
IF @activo = 0 AND @id_empleado = @__emp
    THROW 50530, 'No puede desactivar su propio empleado: perdería el acceso al sistema.', 1;`;

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
  ctx.sp('sp_CambiarEstadoEmpleado', { id_empleado: id(req.params.id), ...tomar(exigir(req.body, ['activo']), ['activo']) },
    {}, { antes: NO_EMPLEADO_PROPIO })));

/* ------------------------ Usuarios del sistema -------------------- */

// Sobre la cuenta propia no se cambia el rol ni se desactiva; otro administrador debe hacerlo.
const NO_CUENTA_PROPIA = (accion) => `
IF @id_usuario_sistema = @__uid
    THROW 50530, 'No puede ${accion} su propia cuenta. Pídaselo a otro administrador.', 1;`;

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

// PUT /usuarios/:id  { id_rol?, id_empleado? }  No se permite sobre la cuenta propia.
router.put('/usuarios/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ModificarUsuarioSistema', { id_usuario_sistema: id(req.params.id), ...tomar(req.body, ['id_rol', 'id_empleado']) },
    {}, { antes: NO_CUENTA_PROPIA('cambiar el rol o el empleado de') })));

// PUT /usuarios/:id/contrasena  { nueva }  Restablecimiento por el administrador.
router.put('/usuarios/:id/contrasena', ruta(GESTIONAR, (req, ctx) => {
  const { nueva } = exigir(req.body || {}, ['nueva']);
  return ctx.sp('sp_CambiarContrasenaUsuario', { id_usuario_sistema: id(req.params.id), contrasena_nueva: String(nueva) });
}));

// POST /usuarios/:id/desactivar  y  /usuarios/:id/reactivar (también desbloquea)
router.post('/usuarios/:id/desactivar', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_DesactivarUsuarioSistema', { id_usuario_sistema: id(req.params.id) },
    {}, { antes: NO_CUENTA_PROPIA('desactivar') })));
router.post('/usuarios/:id/reactivar', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ReactivarUsuarioSistema', { id_usuario_sistema: id(req.params.id) })));

// GET /usuarios/:id/permisos
router.get('/usuarios/:id/permisos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ConsultarPermisosUsuario', { id_usuario_sistema: id(req.params.id) })));

/* ------------------------ Roles y permisos ------------------------ */

// Roles que crea 16_datos_iniciales.sql. La matriz de acceso de la sección 7 los usa por nombre.
const ROLES_BASE = ['Junta Directiva', 'Administrador del Sistema', 'Fontanero', 'Administrador de BD'];
const ROL_ADMINISTRADOR = 'Administrador del Sistema';
// CU-6.6 3a: el rol Administrador no puede quedar sin los permisos de seguridad.
const PERMISOS_SEGURIDAD = [P.GESTIONAR_SEGURIDAD, P.CONSULTAR_BITACORA];
// La API reconoce los permisos por su nombre (src/permisos.js); renombrarlos rompe el acceso.
const PERMISOS_API = Object.values(P);

// Arma una lista N'a', N'b' para un IN (...). Solo se usa con constantes del código.
const listaSql = (valores) => valores.map((v) => `N'${v.replace(/'/g, "''")}'`).join(', ');

// Limpia un nombre de catálogo y valida su largo antes de llamar a la base.
// Los parámetros varchar de SQL Server truncan sin avisar, por eso se valida aquí.
function nombreValido(valor, etiqueta, maximo) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) throw new ErrorApi(400, `El ${etiqueta} es obligatorio.`);
  if (texto.length > maximo) throw new ErrorApi(400, `El ${etiqueta} admite como máximo ${maximo} caracteres.`);
  return texto;
}

// CU-6.5 2a: los roles base no se eliminan ni se renombran.
const ROL_NO_BASE = (accion) => `
IF EXISTS (SELECT 1 FROM dbo.Rol WHERE id_rol = @id_rol AND nombre_rol IN (${listaSql(ROLES_BASE)}))
    THROW 50532, 'Los roles base del sistema no se pueden ${accion}.', 1;`;

const RENOMBRAR_ROL = `
IF EXISTS (SELECT 1 FROM dbo.Rol WHERE id_rol = @id_rol AND nombre_rol <> @nombre_rol
           AND nombre_rol IN (${listaSql(ROLES_BASE)}))
    THROW 50532, 'Los roles base del sistema no se pueden renombrar.', 1;`;

// CU-6.6 3a y protección contra quitarse a sí mismo la gestión de seguridad.
const QUITAR_PERMISO = `
IF EXISTS (SELECT 1 FROM dbo.Rol r, dbo.Permiso p
           WHERE r.id_rol = @id_rol AND p.id_permiso = @id_permiso
             AND r.nombre_rol = N'${ROL_ADMINISTRADOR}' AND p.nombre_permiso IN (${listaSql(PERMISOS_SEGURIDAD)}))
    THROW 50533, 'El rol Administrador del Sistema no puede quedar sin los permisos de seguridad.', 1;
IF EXISTS (SELECT 1 FROM dbo.Usuario_Sistema u, dbo.Permiso p
           WHERE u.id_usuario_sistema = @__uid AND u.id_rol = @id_rol
             AND p.id_permiso = @id_permiso AND p.nombre_permiso = N'${P.GESTIONAR_SEGURIDAD}')
    THROW 50533, 'No puede quitarle a su propio rol el permiso de gestionar la seguridad.', 1;`;

const RENOMBRAR_PERMISO = `
IF EXISTS (SELECT 1 FROM dbo.Permiso WHERE id_permiso = @id_permiso AND nombre_permiso <> @nombre_permiso
           AND nombre_permiso IN (${listaSql(PERMISOS_API)}))
    THROW 50534, 'Este permiso lo usa la API por su nombre; renombrarlo quitaría el acceso a quienes lo tienen.', 1;`;

// CU-6.5 paso 5: Rol, Permiso y Modulo no tienen trigger de auditoría, se registra aquí.
const registrar = (accion, tabla, descripcion) => `
DECLARE @__descripcion varchar(max) = ${descripcion};
EXEC dbo.sp_RegistrarEventoBitacora @accion = '${accion}', @tabla_afectada = '${tabla}', @descripcion = @__descripcion;`;

// GET /roles   POST /roles { nombre_rol }   PUT /roles/:id { nombre_rol }   DELETE /roles/:id  CU-6.5
router.get('/roles', ruta(GESTIONAR, (_req, ctx) => ctx.sp('sp_ConsultarRoles')));
router.post('/roles', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarRol', { nombre_rol: nombreValido(req.body?.nombre_rol, 'nombre del rol', 25) }, { id_rol: sql.Int },
    { despues: registrar('INSERT', 'Rol', `CONCAT('Alta del rol "', @nombre_rol, '".')`) }), { estado: 201 }));
router.put('/roles/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarRol', { nombre_rol: nombreValido(req.body?.nombre_rol, 'nombre del rol', 25), id_rol: id(req.params.id) },
    { id_rol: sql.Int }, {
      antes: RENOMBRAR_ROL,
      despues: registrar('UPDATE', 'Rol', `CONCAT('Rol ', @id_rol, ' renombrado a "', @nombre_rol, '".')`),
    })));
router.delete('/roles/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_EliminarRol', { id_rol: id(req.params.id) }, {}, { antes: ROL_NO_BASE('eliminar') })));

// GET /roles/:id/permisos   POST /roles/:id/permisos { id_permiso }   DELETE /roles/:id/permisos/:idPermiso  CU-6.6
router.get('/roles/:id/permisos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ConsultarPermisosPorRol', { id_rol: id(req.params.id) })));
router.post('/roles/:id/permisos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AsignarPermisoRol', { id_rol: id(req.params.id), ...tomar(req.body, ['id_permiso']) }), { estado: 201 }));
router.delete('/roles/:id/permisos/:idPermiso', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_QuitarPermisoRol', { id_rol: id(req.params.id), id_permiso: id(req.params.idPermiso, 'id de permiso') },
    {}, { antes: QUITAR_PERMISO })));

// GET /permisos   POST /permisos { id_modulo, nombre_permiso }   PUT /permisos/:id
router.get('/permisos', ruta(GESTIONAR, (_req, ctx) => ctx.sp('sp_ConsultarPermisos')));
router.post('/permisos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarPermiso', {
    ...tomar(exigir(req.body || {}, ['id_modulo']), ['id_modulo']),
    nombre_permiso: nombreValido(req.body?.nombre_permiso, 'nombre del permiso', 50),
  }, { id_permiso: sql.Int },
  { despues: registrar('INSERT', 'Permiso', `CONCAT('Alta del permiso "', @nombre_permiso, '".')`) }), { estado: 201 }));
router.put('/permisos/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarPermiso', {
    ...tomar(exigir(req.body || {}, ['id_modulo']), ['id_modulo']),
    nombre_permiso: nombreValido(req.body?.nombre_permiso, 'nombre del permiso', 50),
    id_permiso: id(req.params.id),
  }, { id_permiso: sql.Int }, {
    antes: RENOMBRAR_PERMISO,
    despues: registrar('UPDATE', 'Permiso', `CONCAT('Permiso ', @id_permiso, ': "', @nombre_permiso, '" en el módulo ', @id_modulo, '.')`),
  })));

// GET /modulos   POST /modulos { nombre_modulo }   PUT /modulos/:id   GET /modulos/:id/permisos
router.get('/modulos', ruta(GESTIONAR, (_req, ctx) => ctx.sp('sp_ConsultarModulos')));
router.post('/modulos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarModulo', { nombre_modulo: nombreValido(req.body?.nombre_modulo, 'nombre del módulo', 50) },
    { id_modulo: sql.Int },
    { despues: registrar('INSERT', 'Modulo', `CONCAT('Alta del módulo "', @nombre_modulo, '".')`) }), { estado: 201 }));
router.put('/modulos/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarModulo', {
    nombre_modulo: nombreValido(req.body?.nombre_modulo, 'nombre del módulo', 50),
    id_modulo: id(req.params.id),
  }, { id_modulo: sql.Int },
  { despues: registrar('UPDATE', 'Modulo', `CONCAT('Módulo ', @id_modulo, ' renombrado a "', @nombre_modulo, '".')`) })));
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
