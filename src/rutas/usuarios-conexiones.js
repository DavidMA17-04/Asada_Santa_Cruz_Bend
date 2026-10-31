// Módulo R1: Gestión de usuarios (abonados), conexiones y medidores. CU-2.x
const express = require('express');
const { sql } = require('../db/contexto');
const { ruta, tomar, id } = require('../utils/http');
const P = require('../permisos');

const router = express.Router();

const CONSULTAR = [P.CONSULTAR_ABONADOS, P.GESTIONAR_ABONADOS];
const GESTIONAR = [P.GESTIONAR_ABONADOS];
// Fontanero, facturación y consulta de facturas necesitan listar medidores (filtros / formularios).
const CONSULTAR_MEDIDORES = [
  ...CONSULTAR,
  P.REGISTRAR_LECTURA,
  P.REGISTRAR_INCIDENCIA,
  P.CONSULTAR_FACTURAS,
  P.GESTIONAR_FACTURACION,
];
// Catálogo de abonados también lo usan los filtros de historial/facturas.
const CONSULTAR_ABONADOS_CATALOGO = [...CONSULTAR, P.CONSULTAR_FACTURAS, P.GESTIONAR_FACTURACION];

const CAMPOS_ABONADO = [
  'tipo_identificacion', 'numero_identidad', 'nombre', 'apellido1', 'apellido2', 'fecha_nacimiento',
  'direccion', 'telefono', 'correo_electronico', 'cedula_representante', 'nombre_representante',
  'apellido1_representante', 'apellido2_representante',
];

function tipoAbonado(valor) {
  return String(valor).toUpperCase();
}

/* ---------------------------- Abonados ---------------------------- */

// GET /abonados?id_abonado=&tipo_abonado=FISICO|JURIDICO&identificacion=&nombre=
router.get('/abonados', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ConsultarAbonado', tomar(req.query, ['id_abonado', 'tipo_abonado', 'identificacion', 'nombre']))));

// GET /abonados/todos  Listado completo (vista unificada de físicos y jurídicos).
router.get('/abonados/todos', ruta(CONSULTAR_ABONADOS_CATALOGO, (_req, ctx) => ctx.vista('vw_Abonados')));

// POST /abonados  CU-2.1. Si tipo_identificacion es JURIDICA se crea un abonado jurídico.
router.post('/abonados', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_Nuevo_Abonado', tomar(req.body, CAMPOS_ABONADO),
    { id_abonado: sql.Int, tipo_abonado: sql.VarChar(10) }), { estado: 201 }));

// PUT /abonados/:tipo/:id  CU-2.2
router.put('/abonados/:tipo/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_ModificarAbonado', {
    tipo_abonado: tipoAbonado(req.params.tipo),
    id_abonado: id(req.params.id),
    ...tomar(req.body, [
      'direccion', 'telefono', 'correo_electronico', 'nombre', 'apellido1', 'apellido2',
      'cedula_representante', 'nombre_representante', 'apellido1_representante', 'apellido2_representante',
    ]),
  })));

// DELETE /abonados/:tipo/:id  Baja lógica (R1-01). Falla si tiene conexiones activas o saldos.
router.delete('/abonados/:tipo/:id', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_DesactivarAbonado', { tipo_abonado: tipoAbonado(req.params.tipo), id_abonado: id(req.params.id) })));

// GET /abonados/:tipo/:id/conexiones
router.get('/abonados/:tipo/:id/conexiones', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_ConsultarConexionesPorAbonado', { tipo_abonado: tipoAbonado(req.params.tipo), id_abonado: id(req.params.id) })));

/* --------------------------- Conexiones --------------------------- */

// GET /conexiones/no-activas?estado=Suspendida|Cortada|Inactiva  CU-2.9
router.get('/conexiones/no-activas', ruta(CONSULTAR, (req, ctx) =>
  ctx.sp('sp_AbonadoInactivo', tomar(req.query, ['estado']))));

// POST /conexiones  CU-2.4  { tipo_abonado, id_abonado, id_tarifa, ubicacion }
router.post('/conexiones', ruta(GESTIONAR, (req, ctx) => {
  const datos = tomar(req.body, ['tipo_abonado', 'id_abonado', 'id_tarifa', 'ubicacion']);
  if (datos.tipo_abonado) datos.tipo_abonado = tipoAbonado(datos.tipo_abonado);
  return ctx.sp('sp_RegistrarConexion', datos, { id_conexion: sql.Int });
}, { estado: 201 }));

// PATCH /conexiones/:id/estado  CU-2.7  { nuevo_estado, motivo }
router.patch('/conexiones/:id/estado', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_CambiarEstadoConexion', { id_conexion: id(req.params.id), ...tomar(req.body, ['nuevo_estado', 'motivo']) })));

// PATCH /conexiones/:id/tarifa  CU-2.5  { id_tarifa, motivo? }
router.patch('/conexiones/:id/tarifa', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AsignarTarifaConexion', { id_conexion: id(req.params.id), ...tomar(req.body, ['id_tarifa', 'motivo']) })));

// GET /conexiones/:id/medidor  ¿La conexión tiene medidor activo?
router.get('/conexiones/:id/medidor', ruta(CONSULTAR_MEDIDORES, (req, ctx) =>
  ctx.sp('sp_MedidorExiste', { id_conexion: id(req.params.id) }, { existe: sql.Bit, id_medidor: sql.Int })));

// POST /conexiones/:id/medidor  CU-3.5  { numero_serie, lectura_inicial?, sustituir? }
router.post('/conexiones/:id/medidor', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_AsignarMedidorConexion',
    { id_conexion: id(req.params.id), ...tomar(req.body, ['numero_serie', 'lectura_inicial', 'sustituir']) },
    { id_medidor: sql.Int }), { estado: 201 }));

/* ---------------------------- Medidores --------------------------- */

// GET /medidores?numero_serie=&id_conexion=&estado=
router.get('/medidores', ruta(CONSULTAR_MEDIDORES, (req, ctx) =>
  ctx.sp('sp_ConsultarMedidores', tomar(req.query, ['numero_serie', 'id_conexion', 'estado']))));

const MEDIDOR_LECTURA_COLS = `
  m.id_medidor, m.numero_serie, m.id_conexion, c.ubicacion,
  COALESCE(
    NULLIF(LTRIM(RTRIM(CONCAT(af.nombre, ' ', af.apellido1, ' ', ISNULL(af.apellido2, '')))), ''),
    aj.razon_social
  ) AS abonado,
  m.ultima_lectura, m.fecha_ultima_lectura`;

const MEDIDOR_LECTURA_FROM = `
  FROM dbo.Medidor m
  JOIN dbo.Conexion c ON c.id_conexion = m.id_conexion
  LEFT JOIN dbo.Abonado_Fisico af ON af.id_abonado_fisico = c.id_abonado_fisico
  LEFT JOIN dbo.Abonado_Juridico aj ON aj.id_abonado_juridico = c.id_abonado_juridico`;

// GET /medidores/para-lectura  Activos con ultima_lectura (catálogo del formulario de registro).
router.get('/medidores/para-lectura', ruta(CONSULTAR_MEDIDORES, (_req, ctx) => ctx.lote(`
  SELECT ${MEDIDOR_LECTURA_COLS}
  ${MEDIDOR_LECTURA_FROM}
  WHERE m.estado = 'Activo'
  ORDER BY m.numero_serie, m.id_medidor;`)));

// GET /medidores/sin-lectura  Medidores sin lectura en el mes actual (ruta del fontanero).
// Incluye ultima_lectura (referencia para el formulario) y ordena por ubicación + serie.
router.get('/medidores/sin-lectura', ruta(CONSULTAR_MEDIDORES, (_req, ctx) => ctx.lote(`
  SELECT ${MEDIDOR_LECTURA_COLS},
         DATEDIFF(DAY, m.fecha_ultima_lectura, GETDATE()) AS dias_sin_lectura
  ${MEDIDOR_LECTURA_FROM}
  WHERE m.estado = 'Activo'
    AND c.estado = 'Activa'
    AND NOT EXISTS (
          SELECT 1 FROM dbo.Lectura l
          WHERE l.id_medidor = m.id_medidor
            AND l.fecha_lectura_actual >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
    )
  ORDER BY c.ubicacion, m.numero_serie, m.id_medidor;`)));

// PATCH /medidores/:id/desactivar  { nuevo_estado?: Dañado|Sustituido|Retirado, motivo? }
router.patch('/medidores/:id/desactivar', ruta(GESTIONAR, (req, ctx) =>
  ctx.sp('sp_DesactivarMedidor', { id_medidor: id(req.params.id), ...tomar(req.body, ['nuevo_estado', 'motivo']) })));

module.exports = router;
