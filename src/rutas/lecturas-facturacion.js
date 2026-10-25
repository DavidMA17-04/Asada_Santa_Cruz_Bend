// Módulo R2: Lecturas y facturación (CU-3.x) y R9: alertas de consumo anómalo.
const express = require('express');
const { sql } = require('../db/contexto');
const { ruta, tomar, id } = require('../utils/http');
const P = require('../permisos');

const router = express.Router();

const CONSULTAR = [P.CONSULTAR_FACTURAS, P.GESTIONAR_FACTURACION];
const GESTIONAR = [P.GESTIONAR_FACTURACION];

/* ---------------------------- Lecturas ---------------------------- */

// POST /lecturas  CU-3.1  { id_medidor, lectura_actual, fecha_lectura? }
// El consumo se calcula en la base; la detección de consumo anómalo corre en el trigger.
router.post('/lecturas', ruta([P.REGISTRAR_LECTURA, P.GESTIONAR_FACTURACION], (req, ctx) =>
  ctx.sp('sp_RegistrarLectura', tomar(req.body, ['id_medidor', 'lectura_actual', 'fecha_lectura']),
    { id_lectura: sql.Int, consumo: sql.Decimal(10, 2) }), { estado: 201 }));

// PUT /lecturas/:id  CU-3.4  { lectura_actual_nueva, motivo }
router.put('/lecturas/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ActualizarLectura', { id_lectura: id(req.params.id), ...tomar(req.body, ['lectura_actual_nueva', 'motivo']) })));

// GET /lecturas/historial?tipo_abonado=&id_abonado=&id_conexion=&id_medidor=&desde=&hasta=  CU-3.11
router.get('/lecturas/historial', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_HistorialConsumo', tomar(req.query, ['tipo_abonado', 'id_abonado', 'id_conexion', 'id_medidor', 'desde', 'hasta']))));

// GET /lecturas/resumen-mensual  Consumo mensual por conexión.
router.get('/lecturas/resumen-mensual', ruta(CONSULTAR, (_req, ctx) => ctx.vista('vw_ResumenConsumoMensual')));

/* ---------------------------- Facturas ---------------------------- */

// GET /facturas?tipo_abonado=&id_abonado=&id_conexion=&periodo=AAAAMM&estado=  CU-3.10
router.get('/facturas', ruta([...CONSULTAR, P.CONSULTAR_PAGOS, P.GESTIONAR_PAGOS], (req, ctx) =>
  ctx.sp('sp_ConsultarFacturas', tomar(req.query, ['tipo_abonado', 'id_abonado', 'id_conexion', 'periodo', 'estado']))));

// GET /facturas/pendientes  CU-4.6
router.get('/facturas/pendientes', ruta([...CONSULTAR, P.CONSULTAR_PAGOS, P.GESTIONAR_PAGOS], (_req, ctx) =>
  ctx.vista('vw_FacturasPendientes')));

// GET /facturas/:id/saldo  Total, pagos, recargos y saldo pendiente de una factura.
router.get('/facturas/:id/saldo', ruta([...CONSULTAR, P.CONSULTAR_PAGOS, P.GESTIONAR_PAGOS], (req, ctx) =>
  ctx.lote('SELECT * FROM dbo.vw_SaldoFactura WHERE id_factura = @id_factura;', { id_factura: id(req.params.id) })));

// POST /facturas  CU-3.12  { id_lectura, dias_plazo? }
router.post('/facturas', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GenerarFactura', tomar(req.body, ['id_lectura', 'dias_plazo']), { id_factura: sql.Int }), { estado: 201 }));

// POST /facturas/ciclo-mensual  CU-3.8  { anio, mes, dias_plazo? }
router.post('/facturas/ciclo-mensual', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_GenerarFacturacionMensual', tomar(req.body, ['anio', 'mes', 'dias_plazo']), { facturas_generadas: sql.Int })));

// POST /facturas/marcar-vencidas  Pasa a "Vencida" las facturas cuyo plazo ya terminó.
router.post('/facturas/marcar-vencidas', ruta([P.GESTIONAR_FACTURACION, P.GESTIONAR_PAGOS], (_req, ctx) =>
  ctx.sp('sp_ActualizarFacturasVencidas', {}, { facturas_vencidas: sql.Int })));

/* ------------------------ Alertas de consumo ---------------------- */

// GET /alertas?id_medidor=&id_regla_consumo=&estado=Abierta|Resuelta&desde=&hasta=  CU-3.7
router.get('/alertas', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ConsultarAlertasConsumo', tomar(req.query, ['id_medidor', 'id_regla_consumo', 'estado', 'desde', 'hasta']))));

// GET /alertas/activas
router.get('/alertas/activas', ruta([...CONSULTAR, P.CONSULTAR_MANTENIMIENTO], (_req, ctx) => ctx.vista('vw_AlertasActivas')));

// POST /alertas/detectar/:idLectura  CU-3.3  Vuelve a evaluar una lectura contra las reglas.
router.post('/alertas/detectar/:idLectura', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_DetectarConsumoAnomalo', { id_lectura: id(req.params.idLectura, 'id de lectura') }, { id_alerta: sql.Int })));

// PATCH /alertas/:id  { estado: Abierta|Resuelta, observacion?, id_incidencia? }
router.patch('/alertas/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ActualizarEstadoAlertaConsumo',
    { id_alerta: id(req.params.id), ...tomar(req.body, ['estado', 'observacion', 'id_incidencia']) })));

module.exports = router;
