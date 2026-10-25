// Catálogos: tarifas (CU-2.8), métodos de pago (CU-4.4), tipos de trabajo e incidencia (CU-5.10),
// niveles y reglas de consumo (CU-3.6) y tipos de respaldo.
// Cualquier usuario activo puede leerlos (los formularios los necesitan); modificarlos exige
// el permiso de gestión del módulo al que pertenecen.
const express = require('express');
const { sql } = require('../db/contexto');
const { ruta, tomar, id } = require('../utils/http');
const P = require('../permisos');

const router = express.Router();
const LEER = [];

/* ----------------------------- Tarifas ---------------------------- */

const TARIFAS = [P.GESTIONAR_ABONADOS];

// GET /tarifas?id_tipo_tarifa=&solo_activas=
router.get('/tarifas', ruta(LEER, (req, ctx) =>
  ctx.sp('sp_ConsultarTarifas', tomar(req.query, ['id_tipo_tarifa', 'solo_activas']))));
router.get('/tarifas/activas', ruta(LEER, (_req, ctx) => ctx.vista('vw_TarifasActivas')));

// POST /tarifas { id_tipo_tarifa, monto_fijo, monto_por_m3 }
router.post('/tarifas', ruta(TARIFAS, (req, ctx) =>
  ctx.sp('sp_RegistrarTarifa', tomar(req.body, ['id_tipo_tarifa', 'monto_fijo', 'monto_por_m3']),
    { id_tarifa: sql.Int }), { estado: 201 }));

// PUT /tarifas/:id { monto_fijo?, monto_por_m3? }  El cambio queda en Historial_Tarifa.
router.put('/tarifas/:id', ruta(TARIFAS, (req, ctx) =>
  ctx.sp('sp_ModificarTarifa', { id_tarifa: id(req.params.id), ...tomar(req.body, ['monto_fijo', 'monto_por_m3']) })));

router.delete('/tarifas/:id', ruta(TARIFAS, (req, ctx) => ctx.sp('sp_DesactivarTarifa', { id_tarifa: id(req.params.id) })));

router.get('/tarifas/:id/historial', ruta(LEER, (req, ctx) =>
  ctx.sp('sp_ConsultarHistorialTarifa', { id_tarifa: id(req.params.id) })));

// POST /tarifas/simular { consumo_m3, monto_fijo_propuesto, monto_por_m3_propuesto, id_tarifa_actual? }
router.post('/tarifas/simular', ruta(LEER, (req, ctx) =>
  ctx.sp('sp_SimularMontoConTarifa',
    tomar(req.body, ['consumo_m3', 'monto_fijo_propuesto', 'monto_por_m3_propuesto', 'id_tarifa_actual']))));

// Tipos de tarifa: GET, POST { nombre_tarifa, activo? }, PUT /:id
router.get('/tipos-tarifa', ruta(LEER, (_req, ctx) => ctx.sp('sp_ConsultarTiposTarifa')));
router.post('/tipos-tarifa', ruta(TARIFAS, (req, ctx) =>
  ctx.sp('sp_GestionarTipoTarifa', tomar(req.body, ['nombre_tarifa', 'activo']), { id_tipo_tarifa: sql.Int }), { estado: 201 }));
router.put('/tipos-tarifa/:id', ruta(TARIFAS, (req, ctx) =>
  ctx.sp('sp_GestionarTipoTarifa', { ...tomar(req.body, ['nombre_tarifa', 'activo']), id_tipo_tarifa: id(req.params.id) },
    { id_tipo_tarifa: sql.Int })));

/* ------------------------- Métodos de pago ------------------------ */

const METODOS = [P.GESTIONAR_PAGOS];

router.get('/metodos-pago', ruta(LEER, (_req, ctx) => ctx.sp('sp_ConsultarMetodosPago')));
router.get('/metodos-pago/activos', ruta(LEER, (_req, ctx) => ctx.vista('vw_MetodosPagoActivos')));
router.post('/metodos-pago', ruta(METODOS, (req, ctx) =>
  ctx.sp('sp_GestionarMetodoPago', tomar(req.body, ['nombre_metodo']), { id_metodo_pago: sql.Int }), { estado: 201 }));
router.put('/metodos-pago/:id', ruta(METODOS, (req, ctx) =>
  ctx.sp('sp_GestionarMetodoPago', { ...tomar(req.body, ['nombre_metodo']), id_metodo_pago: id(req.params.id) },
    { id_metodo_pago: sql.Int })));
router.delete('/metodos-pago/:id', ruta(METODOS, (req, ctx) =>
  ctx.sp('sp_DesactivarMetodoPago', { id_metodo_pago: id(req.params.id) })));

/* ------------------- Tipos de trabajo e incidencia ---------------- */

const MANTENIMIENTO = [P.GESTIONAR_MANTENIMIENTO];

router.get('/tipos-trabajo', ruta(LEER, (_req, ctx) => ctx.sp('sp_ConsultarTiposTrabajo')));
router.post('/tipos-trabajo', ruta(MANTENIMIENTO, (req, ctx) =>
  ctx.sp('sp_GestionarTipoTrabajo', tomar(req.body, ['nombre_trabajo', 'activo']), { id_tipo_trabajo: sql.Int }), { estado: 201 }));
router.put('/tipos-trabajo/:id', ruta(MANTENIMIENTO, (req, ctx) =>
  ctx.sp('sp_GestionarTipoTrabajo', { ...tomar(req.body, ['nombre_trabajo', 'activo']), id_tipo_trabajo: id(req.params.id) },
    { id_tipo_trabajo: sql.Int })));

router.get('/tipos-incidencia', ruta(LEER, (_req, ctx) => ctx.sp('sp_ConsultarTiposIncidencia')));
router.post('/tipos-incidencia', ruta(MANTENIMIENTO, (req, ctx) =>
  ctx.sp('sp_GestionarTipoIncidencia', tomar(req.body, ['nombre_incidencia', 'activo']), { id_tipo_incidencia: sql.Int }),
  { estado: 201 }));
router.put('/tipos-incidencia/:id', ruta(MANTENIMIENTO, (req, ctx) =>
  ctx.sp('sp_GestionarTipoIncidencia',
    { ...tomar(req.body, ['nombre_incidencia', 'activo']), id_tipo_incidencia: id(req.params.id) },
    { id_tipo_incidencia: sql.Int })));

/* ----------------- Niveles y reglas de consumo (R9) --------------- */

const CONSUMO = [P.GESTIONAR_FACTURACION];
const CAMPOS_REGLA = ['id_nivel_alerta', 'nombre_regla', 'porcentaje_variacion', 'meses_promedio', 'consumo_minimo', 'descripcion', 'activo'];

router.get('/niveles-alerta', ruta(LEER, (_req, ctx) => ctx.sp('sp_ConsultarNivelesAlerta')));
router.post('/niveles-alerta', ruta(CONSUMO, (req, ctx) =>
  ctx.sp('sp_GestionarNivelAlerta', tomar(req.body, ['nombre_nivel']), { id_nivel_alerta: sql.Int }), { estado: 201 }));
router.put('/niveles-alerta/:id', ruta(CONSUMO, (req, ctx) =>
  ctx.sp('sp_GestionarNivelAlerta', { ...tomar(req.body, ['nombre_nivel']), id_nivel_alerta: id(req.params.id) },
    { id_nivel_alerta: sql.Int })));

// GET /reglas-consumo?solo_activas=false
router.get('/reglas-consumo', ruta(LEER, (req, ctx) => ctx.sp('sp_ConsultarReglasConsumo', tomar(req.query, ['solo_activas']))));
router.post('/reglas-consumo', ruta(CONSUMO, (req, ctx) =>
  ctx.sp('sp_GestionarReglaConsumo', tomar(req.body, CAMPOS_REGLA), { id_regla_consumo: sql.Int }), { estado: 201 }));
router.put('/reglas-consumo/:id', ruta(CONSUMO, (req, ctx) =>
  ctx.sp('sp_GestionarReglaConsumo', { ...tomar(req.body, CAMPOS_REGLA), id_regla_consumo: id(req.params.id) },
    { id_regla_consumo: sql.Int })));

/* ------------------------- Tipos de respaldo ---------------------- */

router.get('/tipos-respaldo', ruta(LEER, (_req, ctx) => ctx.sp('sp_ConsultarTiposRespaldo')));
router.post('/tipos-respaldo', ruta([P.RESPALDOS], (req, ctx) =>
  ctx.sp('sp_GestionarTipoRespaldo', tomar(req.body, ['nombre_respaldo']), { id_tipo_respaldo: sql.Int }), { estado: 201 }));

module.exports = router;
