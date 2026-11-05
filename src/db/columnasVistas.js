/** Columnas de cada vista consultada por la API (alineado con sql/sql/04_vistas.sql). */
const COLUMNAS_VISTAS = {
  vw_Abonados: [
    'tipo_abonado', 'id_abonado', 'tipo_identificacion', 'identificacion', 'nombre_completo',
    'direccion', 'telefono', 'correo_electronico', 'fecha_registro', 'activo',
  ],
  vw_AlertasActivas: [
    'id_alerta', 'nivel', 'nombre_regla', 'medidor', 'id_conexion', 'consumo_promedio',
    'consumo_actual', 'porcentaje_variacion', 'fecha_deteccion', 'id_incidencia', 'observacion',
  ],
  vw_BitacoraReciente: [
    'id_bitacora', 'fecha_registro', 'accion', 'tabla_afectada', 'descripcion',
    'id_usuario_sistema', 'usuario',
  ],
  vw_CargasFallidas: ['id_proceso_etl', 'nombre_tabla_destino', 'fecha_proceso', 'mensaje_error'],
  vw_FacturasPendientes: [
    'id_factura', 'id_conexion', 'tipo_abonado', 'identificacion', 'nombre_completo',
    'fecha_emision', 'fecha_vencimiento', 'monto_total', 'recargos', 'pagado', 'saldo', 'estado', 'dias_atraso',
  ],
  vw_IncidentesAbiertos: [
    'id_incidencia', 'tipo', 'prioridad', 'estado', 'fecha_incidente', 'horas_abierta',
    'descripcion', 'ubicacion', 'medidor', 'id_conexion',
  ],
  vw_MantenimientosPendientes: [
    'id_mantenimiento', 'estado', 'tipo_trabajo', 'responsable', 'id_conexion', 'ubicacion',
    'id_incidencia', 'descripcion', 'fecha_inicio',
  ],
  vw_MetodosPagoActivos: ['id_metodo_pago', 'nombre_metodo'],
  vw_PagosPorMetodo: ['id_metodo_pago', 'nombre_metodo', 'cantidad_pagos', 'total_recaudado'],
  vw_ParametrosMora: ['nombre', 'valor', 'descripcion', 'fecha_modificacion'],
  vw_RecargosPendientes: [
    'id_recargo', 'id_factura', 'fecha_calculo', 'porcentaje_aplicado', 'monto_recargo',
    'saldo_factura', 'fecha_vencimiento', 'id_conexion', 'abonado', 'dias_atraso',
  ],
  vw_ResumenCartera: [
    'fecha_corte', 'total_por_cobrar', 'total_vencido', 'facturas_pendientes', 'facturas_vencidas',
    'conexiones_morosas', 'conexiones_suspendidas', 'recargos_vigentes', 'recaudado_mes', 'pagos_mes',
  ],
  vw_ResumenConsumoMensual: [
    'periodo', 'id_conexion', 'id_abonado_fisico', 'id_abonado_juridico', 'abonado',
    'id_tarifa', 'tipo_tarifa', 'cantidad_lecturas', 'consumo_m3',
  ],
  vw_TarifasActivas: ['id_tarifa', 'id_tipo_tarifa', 'tipo_tarifa', 'monto_fijo', 'monto_por_m3'],
  vw_TramosMora: ['id_tramo', 'dias_desde', 'dias_hasta', 'porcentaje', 'activo'],
  vw_UltimaCargaPorTabla: [
    'nombre_tabla_destino', 'fecha_proceso', 'fecha_ultima_carga', 'filas_procesadas', 'estado', 'mensaje_error',
  ],
  vw_UsuariosBloqueadosPorIntentos: [
    'id_usuario_sistema', 'nombre_usuario', 'nombre_rol', 'intentos_fallidos', 'fecha_ultimo_acceso',
  ],
  vw_UsuariosMorosos: [
    'tipo_abonado', 'id_abonado', 'identificacion', 'nombre_completo', 'id_conexion',
    'cantidad_facturas_vencidas', 'saldo_vencido', 'vencimiento_mas_antiguo', 'dias_atraso_maximo',
  ],
};

function columnasDeVista(nombreVista) {
  const columnas = COLUMNAS_VISTAS[nombreVista];
  if (!columnas) {
    throw new Error(`Vista no registrada en columnasVistas: ${nombreVista}`);
  }
  return columnas.map((columna) => `dbo.${nombreVista}.${columna}`).join(', ');
}

module.exports = { COLUMNAS_VISTAS, columnasDeVista };
