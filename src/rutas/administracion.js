// Módulo Administración de BD y Data Warehouse (R5, R7, R8, R10, RA2). CU-7.x
const express = require('express');
const config = require('../config');
const { sql } = require('../db/contexto');
const { ErrorApi, ruta, tomar, id } = require('../utils/http');
const P = require('../permisos');

const router = express.Router();

const RESPALDOS = [P.RESPALDOS];
const ETL = [P.ETL];
const DW = [P.CONSULTAR_DW];
const BD = [P.MANTENIMIENTO_BD];

/* --------------------- Respaldos y restauración ------------------- */

const CAMPOS_POLITICA = ['id_tipo_respaldo', 'nombre_politica', 'frecuencia', 'hora_ejecucion', 'retencion_dias', 'ruta_destino', 'activo'];

// GET /respaldos/politicas  CU-7.3
router.get('/respaldos/politicas', ruta(RESPALDOS, (_req, ctx) => ctx.lote(`
  SELECT p.id_politica, p.nombre_politica, t.nombre_respaldo AS tipo_respaldo, p.id_tipo_respaldo,
         p.frecuencia, CONVERT(varchar(5), p.hora_ejecucion, 108) AS hora_ejecucion,
         p.retencion_dias, p.ruta_destino, p.activo, p.fecha_creacion
  FROM dbo.Politica_Respaldo p
  JOIN dbo.Tipo_Respaldo t ON t.id_tipo_respaldo = p.id_tipo_respaldo
  ORDER BY p.id_politica;`)));

router.post('/respaldos/politicas', ruta(RESPALDOS, (req, ctx) =>
  ctx.sp('sp_GestionarPoliticaRespaldo', tomar(req.body, CAMPOS_POLITICA), { id_politica: sql.Int }), { estado: 201 }));

router.put('/respaldos/politicas/:id', ruta(RESPALDOS, (req, ctx) =>
  ctx.sp('sp_GestionarPoliticaRespaldo', { ...tomar(req.body, CAMPOS_POLITICA), id_politica: id(req.params.id) },
    { id_politica: sql.Int })));

// POST /respaldos/politicas/:id/ejecutar  CU-7.1  { verificar? }
router.post('/respaldos/politicas/:id/ejecutar', ruta(RESPALDOS, (req, ctx) =>
  ctx.sp('sp_EjecutarRespaldo', { id_politica: id(req.params.id), ...tomar(req.body, ['verificar']) },
    { id_respaldo: sql.Int })));

// GET /respaldos/historial?id_politica=&desde=&hasta=&estado=&verificado=  CU-7.6
router.get('/respaldos/historial', ruta(RESPALDOS, (req, ctx) =>
  ctx.sp('sp_ConsultarHistorialRespaldos', tomar(req.query, ['id_politica', 'desde', 'hasta', 'estado', 'verificado']))));

// POST /respaldos/verificar  CU-7.5  { id_respaldo? }  Sin id verifica los pendientes.
router.post('/respaldos/verificar', ruta(RESPALDOS, (req, ctx) =>
  ctx.sp('sp_VerificarIntegridadRespaldos', tomar(req.body, ['id_respaldo']))));

// POST /respaldos/restaurar  CU-7.2 / CU-7.7
// { punto_recuperacion, motivo, base_destino?, solo_generar_script? }
// Restaura en una base aparte (ASADA_Restaurada por defecto), nunca sobre la productiva.
// Con solo_generar_script = true devuelve la secuencia de RESTORE sin ejecutarla.
router.post('/respaldos/restaurar', ruta(RESPALDOS, (req, ctx) =>
  ctx.sp('sp_RestaurarPuntoEnTiempo',
    tomar(req.body, ['punto_recuperacion', 'motivo', 'base_destino', 'solo_generar_script']),
    { id_restauracion: sql.Int })));

// GET /respaldos/restauraciones?desde=&hasta=&estado=  CU-7.8
router.get('/respaldos/restauraciones', ruta(RESPALDOS, (req, ctx) =>
  ctx.sp('sp_ConsultarHistorialRestauracion', tomar(req.query, ['desde', 'hasta', 'estado']))));

/* ------------------------------ ETL ------------------------------- */

// POST /dw/etl  CU-7.10  { carga_completa? }
router.post('/dw/etl', ruta(ETL, (req, ctx) => ctx.sp('sp_EjecutarCargaDW', tomar(req.body, ['carga_completa']))));

// GET /dw/etl/control?nombre_tabla_destino=&estado=&desde=&hasta=
router.get('/dw/etl/control', ruta([...ETL, ...DW], (req, ctx) =>
  ctx.sp('sp_ConsultarControlETL', tomar(req.query, ['nombre_tabla_destino', 'estado', 'desde', 'hasta']))));

router.get('/dw/etl/ultima-carga', ruta([...ETL, ...DW], (_req, ctx) => ctx.vista('vw_UltimaCargaPorTabla')));
router.get('/dw/etl/fallidas', ruta(ETL, (_req, ctx) => ctx.vista('vw_CargasFallidas')));

router.post('/dw/etl/:id/reintentar', ruta(ETL, (req, ctx) =>
  ctx.sp('sp_ReintentarCargaETL', { id_proceso_etl: id(req.params.id) })));

// POST /dw/validar  Compara totales del DW con el origen.
router.post('/dw/validar', ruta(ETL, (_req, ctx) => ctx.sp('sp_ValidarCargaDW', {}, { problemas: sql.Int })));

// GET /dw/conciliar?periodo=AAAAMM
router.get('/dw/conciliar', ruta([...ETL, ...DW], (req, ctx) => ctx.sp('sp_ConciliarOrigenDW', tomar(req.query, ['periodo']))));

/* ------------------- Análisis en el Data Warehouse ---------------- */
// CU-1.4 / CU-7.11. Consultas de solo lectura sobre ASADA_DW.
// La bitácora reutiliza dbo.sp_RegistrarEventoBitacora (script 09).
// El encabezado de Contexto valida permiso antes del SELECT: un 403 no
// llega al EXEC y no se registra como CONSULTA. Si el INSERT de bitácora
// falla, el lote aborta y no se responde { ok: true } (mismo criterio
// que triggers y ETL: el registro no se omite en silencio).

const dw = (tabla) => `${config.db.baseDW}.dbo.${tabla}`;

function loteConsultaDW(ctx, cuerpo, entradas, tabla, descripcion) {
  return ctx.lote(`${cuerpo}
EXEC dbo.sp_RegistrarEventoBitacora
    @accion = @accion_auditoria,
    @tabla_afectada = @tabla_auditoria,
    @descripcion = @descripcion_auditoria;`, {
    ...entradas,
    accion_auditoria: 'CONSULTA',
    tabla_auditoria: tabla,
    descripcion_auditoria: descripcion,
  });
}

function enteroOpcional(valor, nombre) {
  if (valor === undefined || valor === '') return null;
  if (!/^\d+$/.test(String(valor))) throw new ErrorApi(400, `"${nombre}" debe ser un número entero.`);
  return Number(valor);
}

const AGRUPAR_CONSUMO = {
  mes:      { columnas: 't.anio, t.mes, t.nombre_mes', orden: 't.anio, t.mes' },
  distrito: { columnas: "ISNULL(c.distrito, 'Sin distrito') AS distrito", orden: '1' },
  tarifa:   { columnas: 'ta.tipo_tarifa', orden: '1' },
};

// GET /dw/consumo?anio=&por=mes|distrito|tarifa
router.get('/dw/consumo', ruta(DW, (req, ctx) => {
  const agrupar = AGRUPAR_CONSUMO[req.query.por || 'mes'];
  if (!agrupar) throw new ErrorApi(400, '"por" debe ser mes, distrito o tarifa.');
  const grupo = agrupar.columnas.replace(/ AS \w+/g, '');
  return loteConsultaDW(ctx, `
    SELECT ${agrupar.columnas},
           COUNT(*) AS lecturas,
           SUM(f.consumo_m3) AS consumo_total_m3,
           CAST(AVG(f.consumo_m3) AS decimal(10,2)) AS consumo_promedio_m3
    FROM ${dw('FACT_CONSUMO')} f
    JOIN ${dw('DIM_TIEMPO')}   t  ON t.id_tiempo = f.id_tiempo
    JOIN ${dw('DIM_CONEXION')} c  ON c.id_conexion_dw = f.id_conexion_dw
    JOIN ${dw('DIM_TARIFA')}   ta ON ta.id_tarifa_dw = f.id_tarifa_dw
    WHERE @anio IS NULL OR t.anio = @anio
    GROUP BY ${grupo}
    ORDER BY ${agrupar.orden};`, { anio: enteroOpcional(req.query.anio, 'anio') },
    'FACT_CONSUMO', 'Consulta del reporte de consumo del Data Warehouse.');
}));

// GET /dw/facturacion?anio=  Facturado contra recaudado por mes.
router.get('/dw/facturacion', ruta(DW, (req, ctx) => loteConsultaDW(ctx, `
  WITH facturado AS (
    SELECT t.anio, t.mes, COUNT(*) AS facturas, SUM(f.monto_total) AS monto_facturado
    FROM ${dw('FACT_FACTURACION')} f JOIN ${dw('DIM_TIEMPO')} t ON t.id_tiempo = f.id_tiempo
    WHERE @anio IS NULL OR t.anio = @anio
    GROUP BY t.anio, t.mes
  ), recaudado AS (
    SELECT t.anio, t.mes, COUNT(*) AS pagos, SUM(p.monto_pagado) AS monto_recaudado, SUM(p.monto_recargo) AS recargos_cobrados
    FROM ${dw('FACT_PAGO')} p JOIN ${dw('DIM_TIEMPO')} t ON t.id_tiempo = p.id_tiempo
    WHERE @anio IS NULL OR t.anio = @anio
    GROUP BY t.anio, t.mes
  )
  SELECT COALESCE(f.anio, r.anio) AS anio, COALESCE(f.mes, r.mes) AS mes,
         ISNULL(f.facturas, 0) AS facturas, ISNULL(f.monto_facturado, 0) AS monto_facturado,
         ISNULL(r.pagos, 0) AS pagos, ISNULL(r.monto_recaudado, 0) AS monto_recaudado,
         ISNULL(r.recargos_cobrados, 0) AS recargos_cobrados
  FROM facturado f
  FULL JOIN recaudado r ON r.anio = f.anio AND r.mes = f.mes
  ORDER BY 1, 2;`, { anio: enteroOpcional(req.query.anio, 'anio') },
  'FACT_FACTURACION', 'Consulta del reporte de facturación del Data Warehouse.')));

// GET /dw/morosidad?fecha_corte=AAAAMMDD  Por distrito; sin fecha usa el último corte cargado.
router.get('/dw/morosidad', ruta(DW, (req, ctx) => loteConsultaDW(ctx, `
  DECLARE @corte int = COALESCE(@fecha_corte, (SELECT MAX(id_tiempo) FROM ${dw('FACT_MOROSIDAD')}));
  SELECT @corte AS fecha_corte, ISNULL(c.distrito, 'Sin distrito') AS distrito,
         COUNT(DISTINCT m.id_abonado_dw) AS abonados_morosos,
         SUM(m.cantidad_facturas_ven) AS facturas_vencidas,
         SUM(m.saldo_vencido) AS saldo_vencido
  FROM ${dw('FACT_MOROSIDAD')} m
  JOIN ${dw('DIM_CONEXION')} c ON c.id_conexion_dw = m.id_conexion_dw
  WHERE m.id_tiempo = @corte
  GROUP BY c.distrito
  ORDER BY saldo_vencido DESC;`, { fecha_corte: enteroOpcional(req.query.fecha_corte, 'fecha_corte') },
  'FACT_MOROSIDAD', 'Consulta del reporte de morosidad del Data Warehouse.')));

// GET /dw/mantenimientos?anio=&por=tipo|empleado
router.get('/dw/mantenimientos', ruta(DW, (req, ctx) => {
  const por = req.query.por || 'tipo';
  const grupos = {
    tipo:     { dim: `JOIN ${dw('DIM_TIPO_TRABAJO')} d ON d.id_tipo_trabajo_dw = f.id_tipo_trabajo_dw`, col: 'd.nombre_trabajo' },
    empleado: { dim: `JOIN ${dw('DIM_EMPLEADO')} d ON d.id_empleado_dw = f.id_empleado_dw`, col: 'd.nombre_empleado' },
  };
  const g = grupos[por];
  if (!g) throw new ErrorApi(400, '"por" debe ser tipo o empleado.');
  return loteConsultaDW(ctx, `
    SELECT ${g.col} AS ${por === 'tipo' ? 'tipo_trabajo' : 'empleado'},
           COUNT(*) AS mantenimientos,
           CAST(AVG(CAST(f.dias_resolucion AS decimal(10,2))) AS decimal(10,2)) AS dias_promedio_resolucion,
           SUM(CASE WHEN f.estado_final = 'Finalizado' THEN 1 ELSE 0 END) AS finalizados
    FROM ${dw('FACT_MANTENIMIENTO')} f
    JOIN ${dw('DIM_TIEMPO')} t ON t.id_tiempo = f.id_tiempo
    ${g.dim}
    WHERE @anio IS NULL OR t.anio = @anio
    GROUP BY ${g.col}
    ORDER BY mantenimientos DESC;`, { anio: enteroOpcional(req.query.anio, 'anio') },
    'FACT_MANTENIMIENTO', 'Consulta del reporte de mantenimientos del Data Warehouse.');
}));

// GET /dw/incidencias?anio=&por=tipo|mes|prioridad&id_tipo_incidencia=
const AGRUPAR_INCIDENCIAS = {
  tipo:      { columnas: 'ti.nombre_incidencia AS tipo_incidencia', orden: 'incidencias DESC' },
  mes:       { columnas: 't.anio, t.mes, t.nombre_mes', orden: 't.anio, t.mes' },
  prioridad: { columnas: "ISNULL(f.prioridad, 'Sin prioridad') AS prioridad", orden: 'incidencias DESC' },
};

router.get('/dw/incidencias', ruta(DW, (req, ctx) => {
  const agrupar = AGRUPAR_INCIDENCIAS[req.query.por || 'tipo'];
  if (!agrupar) throw new ErrorApi(400, '"por" debe ser tipo, mes o prioridad.');
  const grupo = agrupar.columnas.replace(/ AS \w+/g, '');
  return loteConsultaDW(ctx, `
    SELECT ${agrupar.columnas},
           COUNT(*) AS incidencias,
           SUM(CASE WHEN f.estado = 'Abierta' THEN 1 ELSE 0 END) AS abiertas,
           SUM(CASE WHEN f.estado = 'En proceso' THEN 1 ELSE 0 END) AS en_proceso,
           SUM(CASE WHEN f.estado = 'Resuelta' THEN 1 ELSE 0 END) AS resueltas,
           CAST(AVG(CAST(f.dias_atencion AS decimal(10,2))) AS decimal(10,2)) AS dias_promedio_atencion
    FROM ${dw('FACT_INCIDENCIA')} f
    JOIN ${dw('DIM_TIEMPO')} t ON t.id_tiempo = f.id_tiempo
    JOIN ${dw('DIM_TIPO_INCIDENCIA')} ti ON ti.id_tipo_incidencia_dw = f.id_tipo_incidencia_dw
    WHERE (@anio IS NULL OR t.anio = @anio)
      AND (@id_tipo_incidencia IS NULL OR ti.id_tipo_incidencia_origen = @id_tipo_incidencia)
    GROUP BY ${grupo}
    ORDER BY ${agrupar.orden};`, {
    anio: enteroOpcional(req.query.anio, 'anio'),
    id_tipo_incidencia: enteroOpcional(req.query.id_tipo_incidencia, 'id_tipo_incidencia'),
  }, 'FACT_INCIDENCIA', 'Consulta del reporte de incidencias del Data Warehouse.');
}));

/* ----------------------- Administración de BD --------------------- */

// GET /bd/monitoreo  CU-7.9
router.get('/bd/monitoreo', ruta(BD, (_req, ctx) => ctx.sp('sp_MonitorearBD')));

// POST /bd/indices  { solo_reporte?, umbral_reorganizar?, umbral_reconstruir?, paginas_minimas? }
router.post('/bd/indices', ruta(BD, (req, ctx) =>
  ctx.sp('sp_MantenimientoIndices',
    tomar(req.body, ['solo_reporte', 'umbral_reorganizar', 'umbral_reconstruir', 'paginas_minimas']))));

// POST /bd/integridad  { base? }  DBCC CHECKDB
router.post('/bd/integridad', ruta(BD, (req, ctx) => ctx.sp('sp_VerificarIntegridadBD', tomar(req.body, ['base']))));

/* ------------------------- Pruebas (R7) --------------------------- */
// Solo se exponen con PERMITIR_PRUEBAS=true en .env (nunca en producción).

if (config.permitirPruebas) {
  router.post('/pruebas/cargar-datos', ruta(BD, (_req, ctx) => ctx.sp('sp_CargarDatosPrueba')));
  router.post('/pruebas/limpiar', ruta(BD, (_req, ctx) => ctx.sp('sp_LimpiarDatosPrueba')));
  router.post('/pruebas/ejecutar', ruta(BD, (_req, ctx) => ctx.sp('sp_EjecutarPruebas')));
}

module.exports = router;
