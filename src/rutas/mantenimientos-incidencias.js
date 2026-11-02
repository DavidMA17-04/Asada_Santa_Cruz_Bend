// Módulo R4: Seguimiento de mantenimientos e incidentes. CU-5.x
const express = require('express');
const { sql } = require('../db/contexto');
const { ruta, tomar, id } = require('../utils/http');
const P = require('../permisos');

const router = express.Router();

const CONSULTAR = [P.CONSULTAR_MANTENIMIENTO, P.GESTIONAR_MANTENIMIENTO];
const GESTIONAR = [P.GESTIONAR_MANTENIMIENTO];
const EJECUTAR = [P.EJECUTAR_MANTENIMIENTO, P.GESTIONAR_MANTENIMIENTO];

// Sección 7.3: el fontanero solo actualiza los mantenimientos que tiene asignados.
// Quien tiene "Gestionar mantenimientos e incidencias" puede actualizar cualquiera.
const SOLO_ASIGNADOS = `
IF dbo.fn_TienePermiso(@__uid, N'${P.GESTIONAR_MANTENIMIENTO}') = 0
   AND NOT EXISTS (SELECT 1 FROM dbo.Mantenimiento
                   WHERE id_mantenimiento = @id_mantenimiento AND id_empleado = @__emp)
    THROW 50403, 'Solo puede actualizar los mantenimientos que tiene asignados.', 1;`;

// Si no puede gestionar, el trabajo queda a nombre del propio empleado.
const EMPLEADO_PROPIO = `
IF dbo.fn_TienePermiso(@__uid, N'${P.GESTIONAR_MANTENIMIENTO}') = 0
    SET @id_empleado = @__emp;`;

/* --------------------------- Incidencias -------------------------- */

// GET /incidencias?estado=&id_tipo_incidencia=&id_conexion=&desde=&hasta=
router.get('/incidencias', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ConsultarIncidencias', tomar(req.query, ['estado', 'id_tipo_incidencia', 'id_conexion', 'desde', 'hasta']))));

// GET /incidencias/abiertas
router.get('/incidencias/abiertas', ruta(CONSULTAR, (_req, ctx) => ctx.vista('vw_IncidentesAbiertos')));

// POST /incidencias  CU-5.1  { id_medidor, id_tipo_incidencia, descripcion, ubicacion?, fecha_incidente?, id_alerta? }
// La prioridad la asigna la base (fn_ClasificarIncidencia).
router.post('/incidencias', ruta([P.REGISTRAR_INCIDENCIA, P.GESTIONAR_MANTENIMIENTO], (req, ctx) =>
  ctx.sp('sp_RegistrarIncidente',
    tomar(req.body, ['id_medidor', 'id_tipo_incidencia', 'descripcion', 'ubicacion', 'fecha_incidente', 'id_alerta']),
    { id_incidencia: sql.Int }), { estado: 201 }));

// PATCH /incidencias/:id/estado  CU-5.3  { nuevo_estado: Abierta|En proceso|Resuelta, observacion? }
router.patch('/incidencias/:id/estado', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_CambiarEstadoIncidencia',
    { id_incidencia: id(req.params.id), ...tomar(req.body, ['nuevo_estado', 'observacion']) })));

// PATCH /incidencias/:id/prioridad  { nueva_prioridad?: Alta|Media|Baja, observacion }
router.patch('/incidencias/:id/prioridad', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_EscalarPrioridadIncidencia',
    { id_incidencia: id(req.params.id), ...tomar(req.body, ['nueva_prioridad', 'observacion']) })));

// POST /incidencias/:id/cerrar  { solucion }
router.post('/incidencias/:id/cerrar', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_CerrarIncidente', { id_incidencia: id(req.params.id), ...tomar(req.body, ['solucion']) })));

// POST /incidencias/:id/reabrir  { motivo }
router.post('/incidencias/:id/reabrir', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ReabrirIncidencia', { id_incidencia: id(req.params.id), ...tomar(req.body, ['motivo']) })));

// GET /incidencias/:id/historial  CU-5.9
router.get('/incidencias/:id/historial', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ConsultarHistorialIncidencia', { id_incidencia: id(req.params.id) })));

// POST /incidencias/:id/mantenimiento  CU-5.6  { id_empleado, id_tipo_trabajo, descripcion?, fecha_inicio? }
router.post('/incidencias/:id/mantenimiento', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AsignarMantenimiento',
    { id_incidencia: id(req.params.id), ...tomar(req.body, ['id_empleado', 'id_tipo_trabajo', 'descripcion', 'fecha_inicio']) },
    { id_mantenimiento: sql.Int }), { estado: 201 }));

// POST /incidencias/:id/mantenimiento-automatico  { id_tipo_trabajo, descripcion?, fecha_inicio? }
router.post('/incidencias/:id/mantenimiento-automatico', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AsignarMantenimientoAutomatico',
    { id_incidencia: id(req.params.id), ...tomar(req.body, ['id_tipo_trabajo', 'descripcion', 'fecha_inicio']) },
    { id_empleado_asignado: sql.Int, id_mantenimiento: sql.Int }), { estado: 201 }));

/* ------------------------- Mantenimientos ------------------------- */

// GET /mantenimientos?estado=&id_empleado=&id_conexion=&id_incidencia=
router.get('/mantenimientos', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ConsultarMantenimientos', tomar(req.query, ['estado', 'id_empleado', 'id_conexion', 'id_incidencia']))));

// GET /mantenimientos/pendientes
router.get('/mantenimientos/pendientes', ruta(CONSULTAR, (_req, ctx) => ctx.vista('vw_MantenimientosPendientes')));

// GET /mantenimientos/mios  Mantenimientos asignados al empleado de la sesión.
router.get('/mantenimientos/mios', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ConsultarMantenimientos', { id_empleado: req.usuario.id_empleado, ...tomar(req.query, ['estado']) })));

// GET /mantenimientos/resumen-operativo?desde=&hasta=
router.get('/mantenimientos/resumen-operativo', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ResumenOperativoMantenimientos', tomar(req.query, ['desde', 'hasta']))));

// POST /mantenimientos  CU-5.5  { id_empleado, id_tipo_trabajo, id_conexion, descripcion?, id_incidencia?, fecha_inicio? }
router.post('/mantenimientos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ProgramarMantenimiento',
    tomar(req.body, ['id_empleado', 'id_tipo_trabajo', 'id_conexion', 'descripcion', 'id_incidencia', 'fecha_inicio']),
    { id_mantenimiento: sql.Int }), { estado: 201 }));

// POST /mantenimientos/preventivo-masivo  { id_tipo_trabajo, id_empleado?, dias_sin_mantenimiento?, descripcion?, fecha_inicio? }
router.post('/mantenimientos/preventivo-masivo', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ProgramarMantenimientoPreventivoMasivo',
    tomar(req.body, ['id_tipo_trabajo', 'id_empleado', 'dias_sin_mantenimiento', 'descripcion', 'fecha_inicio']),
    { cantidad_programados: sql.Int }), { estado: 201 }));

// POST /mantenimientos/realizados  Registra un trabajo que ya se hizo (queda finalizado).
// { id_conexion, id_tipo_trabajo, descripcion, fecha_inicio, fecha_fin?, id_incidencia?, id_empleado? }
router.post('/mantenimientos/realizados', ruta(EJECUTAR, (req, ctx) =>
  ctx.sp('sp_EmpleadoMantenimiento', {
    id_empleado: req.usuario.id_empleado,
    ...tomar(req.body, ['id_empleado', 'id_conexion', 'id_tipo_trabajo', 'descripcion', 'fecha_inicio', 'fecha_fin', 'id_incidencia']),
  }, { id_mantenimiento: sql.Int }, { antes: EMPLEADO_PROPIO }), { estado: 201 }));

// PATCH /mantenimientos/:id/estado  CU-5.7  { nuevo_estado: Programado|En proceso|Finalizado|Cancelado, anotacion? }
router.patch('/mantenimientos/:id/estado', ruta(EJECUTAR, (req, ctx) =>
  ctx.sp('sp_CambiarEstadoMantenimiento',
    { id_mantenimiento: id(req.params.id), ...tomar(req.body, ['nuevo_estado', 'anotacion']) },
    {}, { antes: SOLO_ASIGNADOS })));

// PATCH /mantenimientos/:id/reasignar  { id_nuevo_empleado, motivo }
router.patch('/mantenimientos/:id/reasignar', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ReasignarMantenimiento',
    { id_mantenimiento: id(req.params.id), ...tomar(req.body, ['id_nuevo_empleado', 'motivo']) })));

// POST /mantenimientos/:id/cerrar  { detalle, fecha_fin?, cerrar_incidencia? }
router.post('/mantenimientos/:id/cerrar', ruta(EJECUTAR, (req, ctx) =>
  ctx.sp('sp_CerrarMantenimiento',
    { id_mantenimiento: id(req.params.id), ...tomar(req.body, ['detalle', 'fecha_fin', 'cerrar_incidencia']) },
    {}, { antes: SOLO_ASIGNADOS })));

// GET /mantenimientos/:id/historial
router.get('/mantenimientos/:id/historial', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ConsultarHistorialMantenimiento', { id_mantenimiento: id(req.params.id) })));

module.exports = router;
