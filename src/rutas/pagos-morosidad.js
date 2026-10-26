// Módulo R3: Control de pagos y morosidad. CU-4.x
const express = require('express');
const { sql } = require('../db/contexto');
const { ruta, tomar, id } = require('../utils/http');
const P = require('../permisos');

const router = express.Router();

const CONSULTAR = [P.CONSULTAR_PAGOS, P.GESTIONAR_PAGOS];
const GESTIONAR = [P.GESTIONAR_PAGOS];

/* ------------------------------ Pagos ----------------------------- */

// GET /pagos?tipo_abonado=&id_abonado=&id_factura=&desde=&hasta=&incluir_anulados=  CU-4.5
router.get('/pagos', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ConsultarHistorialPagos',
    tomar(req.query, ['tipo_abonado', 'id_abonado', 'id_factura', 'desde', 'hasta', 'incluir_anulados']))));

// GET /pagos/por-metodo  Recaudación agrupada por método de pago.
router.get('/pagos/por-metodo', ruta(CONSULTAR, (_req, ctx) => ctx.vista('vw_PagosPorMetodo')));

// POST /pagos  CU-4.1  { id_factura, id_metodo_pago, monto, fecha_pago? }
// Pago parcial permitido; si el monto excede el saldo, la base lo rechaza.
router.post('/pagos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_RegistrarPago', tomar(req.body, ['id_factura', 'id_metodo_pago', 'monto', 'fecha_pago']),
    { id_pago: sql.Int }), { estado: 201 }));

// POST /pagos/:id/anular  { motivo }
router.post('/pagos/:id/anular', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AnularPago', { id_pago: id(req.params.id), ...tomar(req.body, ['motivo']) })));

// PATCH /facturas/:id/prorroga  { nueva_fecha_vencimiento, motivo }
router.patch('/facturas/:id/prorroga', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_OtorgarProrroga', { id_factura: id(req.params.id), ...tomar(req.body, ['nueva_fecha_vencimiento', 'motivo']) })));

// GET /estado-cuenta?tipo_abonado=&id_abonado=&fecha_corte=  CU-4.6
// Devuelve resumen, facturas, pagos y recargos del abonado.
router.get('/estado-cuenta', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_EstadoCuentaAbonado',
    tomar(req.query, ['tipo_abonado', 'id_abonado', 'fecha_corte']))));

/* ------------------------------ Mora ------------------------------ */

// GET /mora/morosos  CU-4.7
router.get('/mora/morosos', ruta(CONSULTAR, (_req, ctx) => ctx.vista('vw_UsuariosMorosos')));

// GET /mora/reporte?dias_minimos_atraso=  CU-4.9
router.get('/mora/reporte', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_GenerarReporteMorosidad', tomar(req.query, ['dias_minimos_atraso']))));

// GET /mora/recargos  Recargos aplicados sobre facturas aún no pagadas.
router.get('/mora/recargos', ruta(CONSULTAR, (_req, ctx) => ctx.vista('vw_RecargosPendientes')));

// POST /mora/facturas/:id/recargo  CU-4.3  { fecha_corte? }
router.post('/mora/facturas/:id/recargo', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_CalcularRecargoMora', { id_factura: id(req.params.id), ...tomar(req.body, ['fecha_corte']) },
    { id_recargo: sql.Int })));

// POST /mora/recargos/aplicar  Recalcula los recargos de todas las facturas vencidas.  { fecha_corte? }
router.post('/mora/recargos/aplicar', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AplicarRecargosMoraMasivo', tomar(req.body, ['fecha_corte']), { recargos_procesados: sql.Int })));

// POST /mora/recargos/:id/anular  { motivo }
router.post('/mora/recargos/:id/anular', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AnularRecargoMora', { id_recargo: id(req.params.id), ...tomar(req.body, ['motivo']) })));

// GET /mora/resumen  Indicadores de cartera para el tablero del módulo.
router.get('/mora/resumen', ruta(CONSULTAR, (_req, ctx) => ctx.vista('vw_ResumenCartera')));

// POST /mora/suspender  { dias_minimos?, saldo_minimo?, solo_simular? }
// Suspende las conexiones morosas según los límites configurados.
router.post('/mora/suspender', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_SuspenderConexionesMorosas',
    tomar(req.body, ['dias_minimos', 'saldo_minimo', 'solo_simular']),
    { suspendidas: sql.Int })));

// POST /mora/reactivar  { solo_simular? }
// Reactiva las conexiones suspendidas que ya no tienen morosidad.
router.post('/mora/reactivar', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ReactivarConexionesSinMora', tomar(req.body, ['solo_simular']),
    { reactivadas: sql.Int })));

/* -------------------------- Configuración -------------------------- */

// GET /mora/parametros
router.get('/mora/parametros', ruta(CONSULTAR, (_req, ctx) => ctx.vista('vw_ParametrosMora')));

// PUT /mora/parametros/:nombre  { valor }
router.put('/mora/parametros/:nombre', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarParametroMora',
    { nombre: req.params.nombre, ...tomar(req.body, ['valor']) })));

// GET /mora/tramos
router.get('/mora/tramos', ruta(CONSULTAR, (_req, ctx) => ctx.vista('vw_TramosMora')));

// POST /mora/tramos  { dias_desde, dias_hasta?, porcentaje, activo? }
router.post('/mora/tramos', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarTramoMora',
    tomar(req.body, ['dias_desde', 'dias_hasta', 'porcentaje', 'activo']),
    { id_tramo_salida: sql.Int }), { estado: 201 }));

// PUT /mora/tramos/:id  { dias_desde, dias_hasta?, porcentaje, activo? }
router.put('/mora/tramos/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GestionarTramoMora',
    { id_tramo: id(req.params.id), ...tomar(req.body, ['dias_desde', 'dias_hasta', 'porcentaje', 'activo']) },
    { id_tramo_salida: sql.Int })));

module.exports = router;
