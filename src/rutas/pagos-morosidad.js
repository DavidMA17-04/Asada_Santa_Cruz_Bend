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

module.exports = router;
