# Backend — API REST del Sistema de Gestión para una ASADA

Node.js + Express sobre la base `ASADA` de SQL Server. La API no repite reglas de negocio: llama a los procedimientos almacenados de `../sql`, y las validaciones, cálculos, triggers y auditoría siguen en la base.

## Arquitectura (DI10)

| Capa | Dónde | Qué hace |
|---|---|---|
| Presentación | [`../frontend`](../frontend/README.md) | Front web que consume esta API con JSON. La misma API lo sirve en `http://localhost:3000/` |
| Lógica de negocio / API | `src/rutas/*.js` | Una ruta por caso de uso; decide qué permiso exige y qué procedimiento llama |
| Acceso a datos | `src/db/` | Pool de conexiones y ejecución de procedimientos con el usuario de la sesión |
| Reglas y datos | `../sql` | Procedimientos, funciones, triggers, vistas, Data Warehouse |

### Cómo se sabe quién hace cada cambio

Los triggers de auditoría leen el usuario de `SESSION_CONTEXT`, que vive en cada conexión. La API usa un pool, así que cada petición puede caer en una conexión distinta. Por eso cada llamada a la base va en **un solo lote** ([src/db/contexto.js](src/db/contexto.js)) que:

1. Guarda `id_usuario_sistema` e `id_empleado` en `SESSION_CONTEXT`.
2. Verifica que el usuario y su empleado sigan activos.
3. Verifica con `fn_TienePermiso` que el rol tenga el permiso que exige la ruta.
4. Ejecuta el procedimiento.

Los permisos se leen de la base en cada petición, no del token. Si se le quita un permiso a un rol o se desactiva un usuario, el cambio aplica de inmediato, aunque el usuario tenga un token vigente.

## Instalación

Requisitos: Node.js 20 o superior, la base instalada con `../sql/ejecutar_todo.sql` y el **ODBC Driver 17 o 18 for SQL Server**, que viene con SSMS.

```bash
cd backend
npm install
cp .env.example .env       # luego complete JWT_SECRETO
npm run dev                # reinicia al guardar cambios
```

Para generar el secreto:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Autenticación con SQL Server.** Con `DB_AUTENTICACION=windows`, la API entra con la cuenta de Windows que la ejecuta. Si el servidor tiene autenticación mixta, use `DB_AUTENTICACION=sql` con `DB_USUARIO` y `DB_CONTRASENA` (por ejemplo, el login `app_asada` del script 15). Para respaldos, restauraciones y `DBCC`, la cuenta necesita permisos de servidor.

## Prueba de humo

```bash
npm run prueba
```

Recorre la API con los tres roles: admin, fontanero y DBA. Verifica permisos, reglas de negocio, que la bitácora y los historiales queden a nombre del usuario correcto, el ETL y las consultas del DW. Con `PERMITIR_PRUEBAS=true`, al final borra lo que creó con `sp_LimpiarDatosPrueba`. El usuario `fontanero.prueba` queda desactivado.

## Uso

1. `POST /api/auth/login` con `{ "usuario": "admin", "contrasena": "Asada#2026" }`. Devuelve `token` y los datos del usuario con sus `permisos`; el front puede usarlos para mostrar u ocultar menús.
2. Las demás peticiones llevan el encabezado `Authorization: Bearer <token>`.

**Respuestas:**

```jsonc
// Éxito
{ "ok": true, "datos": [ ...filas ], "salida": { "id_abonado": 7 } }
// "salida" trae los parámetros OUTPUT del procedimiento.
// "conjuntos" aparece cuando el procedimiento devuelve varios result sets.

// Error
{ "ok": false, "mensaje": "Ya existe un abonado registrado con esa identificación.", "codigo": 50102 }
```

| HTTP | Cuándo |
|---|---|
| 400 | Regla de negocio (`THROW 5xxxx` de un procedimiento), dato faltante o con formato inválido |
| 401 | Sin sesión, token vencido o usuario desactivado |
| 403 | El rol no tiene el permiso |
| 409 | Duplicado o conflicto de integridad |

**Nombres de los campos.** Son los parámetros del procedimiento sin la `@`. Por ejemplo, `sp_RegistrarPago @id_factura, @id_metodo_pago, @monto` se llama con `{ "id_factura": 1, "id_metodo_pago": 1, "monto": 5000 }`. Un campo vacío u omitido toma el valor por defecto del procedimiento. Las fechas van como `AAAA-MM-DD`.

## Rutas

Todas empiezan con `/api`. Entre paréntesis está el permiso que exige cada grupo; con cualquiera de los que se listan basta.

### Sesión — `/auth`
| Método | Ruta | Procedimiento |
|---|---|---|
| POST | `/auth/login` | `sp_IniciarSesion` |
| POST | `/auth/logout` | `sp_CerrarSesion` |
| GET | `/auth/perfil` | datos y permisos del usuario |
| PUT | `/auth/contrasena` `{actual, nueva}` | `sp_CambiarContrasenaUsuario` |

### Usuarios y conexiones (Consultar / Gestionar abonados y conexiones)
| Método | Ruta | Procedimiento |
|---|---|---|
| GET | `/abonados?id_abonado&tipo_abonado&identificacion&nombre` | `sp_ConsultarAbonado` |
| GET | `/abonados/todos` | `vw_Abonados` |
| POST | `/abonados` | `sp_Nuevo_Abonado` (`tipo_identificacion: JURIDICA` crea uno jurídico) |
| PUT | `/abonados/:tipo/:id` (`tipo` = FISICO o JURIDICO) | `sp_ModificarAbonado` |
| DELETE | `/abonados/:tipo/:id` | `sp_DesactivarAbonado` (baja lógica) |
| GET | `/abonados/:tipo/:id/conexiones` | `sp_ConsultarConexionesPorAbonado` |
| POST | `/conexiones` | `sp_RegistrarConexion` |
| GET | `/conexiones/no-activas?estado` | `sp_AbonadoInactivo` |
| PATCH | `/conexiones/:id/estado` `{nuevo_estado, motivo}` | `sp_CambiarEstadoConexion` |
| PATCH | `/conexiones/:id/tarifa` `{id_tarifa, motivo}` | `sp_AsignarTarifaConexion` |
| GET / POST | `/conexiones/:id/medidor` | `sp_MedidorExiste` / `sp_AsignarMedidorConexion` |
| GET | `/medidores?numero_serie&id_conexion&estado` | `sp_ConsultarMedidores` (también lo usa el fontanero) |
| GET | `/medidores/sin-lectura` | `vw_MedidorNoLeido` |
| PATCH | `/medidores/:id/desactivar` | `sp_DesactivarMedidor` |

### Lecturas y facturación (Consultar lecturas y facturas / Gestionar facturación / Registrar lectura)
| Método | Ruta | Procedimiento |
|---|---|---|
| POST | `/lecturas` | `sp_RegistrarLectura` (la alerta de consumo la genera el trigger) |
| PUT | `/lecturas/:id` | `sp_ActualizarLectura` |
| GET | `/lecturas/historial?...` | `sp_HistorialConsumo` |
| GET | `/lecturas/resumen-mensual` | `vw_ResumenConsumoMensual` |
| GET | `/facturas?tipo_abonado&id_abonado&id_conexion&periodo&estado` | `sp_ConsultarFacturas` |
| GET | `/facturas/pendientes` | `vw_FacturasPendientes` |
| GET | `/facturas/:id/saldo` | `vw_SaldoFactura` |
| POST | `/facturas` | `sp_GenerarFactura` |
| POST | `/facturas/ciclo-mensual` `{anio, mes}` | `sp_GenerarFacturacionMensual` |
| POST | `/facturas/marcar-vencidas` | `sp_ActualizarFacturasVencidas` |
| GET | `/alertas?...` / `/alertas/activas` | `sp_ConsultarAlertasConsumo` / `vw_AlertasActivas` |
| POST | `/alertas/detectar/:idLectura` | `sp_DetectarConsumoAnomalo` |
| PATCH | `/alertas/:id` | `sp_ActualizarEstadoAlertaConsumo` |

### Pagos y morosidad (Consultar / Gestionar pagos y morosidad)
| Método | Ruta | Procedimiento |
|---|---|---|
| GET | `/pagos?...` | `sp_ConsultarHistorialPagos` |
| GET | `/pagos/por-metodo` | `vw_PagosPorMetodo` |
| POST | `/pagos` | `sp_RegistrarPago` |
| POST | `/pagos/:id/anular` `{motivo}` | `sp_AnularPago` |
| PATCH | `/facturas/:id/prorroga` | `sp_OtorgarProrroga` |
| GET | `/mora/morosos` | `vw_UsuariosMorosos` |
| GET | `/mora/reporte?dias_minimos_atraso` | `sp_GenerarReporteMorosidad` |
| GET | `/mora/recargos` | `vw_RecargosPendientes` |
| POST | `/mora/facturas/:id/recargo` | `sp_CalcularRecargoMora` |
| POST | `/mora/recargos/aplicar` | `sp_AplicarRecargosMoraMasivo` |
| POST | `/mora/recargos/:id/anular` | `sp_AnularRecargoMora` |

### Mantenimientos e incidencias (Consultar / Gestionar mantenimientos e incidencias / Registrar incidencia / Ejecutar mantenimiento)
| Método | Ruta | Procedimiento |
|---|---|---|
| GET | `/incidencias?...` / `/incidencias/abiertas` | `sp_ConsultarIncidencias` / `vw_IncidentesAbiertos` |
| POST | `/incidencias` | `sp_RegistrarIncidente` |
| PATCH | `/incidencias/:id/estado` | `sp_CambiarEstadoIncidencia` |
| POST | `/incidencias/:id/cerrar` `{solucion}` | `sp_CerrarIncidente` |
| GET | `/incidencias/:id/historial` | `sp_ConsultarHistorialIncidencia` |
| POST | `/incidencias/:id/mantenimiento` | `sp_AsignarMantenimiento` |
| GET | `/mantenimientos?...` / `/mantenimientos/pendientes` | `sp_ConsultarMantenimientos` / `vw_MantenimientosPendientes` |
| GET | `/mantenimientos/mios` | mantenimientos del empleado de la sesión |
| POST | `/mantenimientos` | `sp_ProgramarMantenimiento` |
| POST | `/mantenimientos/realizados` | `sp_EmpleadoMantenimiento` |
| PATCH | `/mantenimientos/:id/estado` | `sp_CambiarEstadoMantenimiento` |
| POST | `/mantenimientos/:id/cerrar` `{detalle}` | `sp_CerrarMantenimiento` |
| GET | `/mantenimientos/:id/historial` | `sp_ConsultarHistorialMantenimiento` |

El fontanero solo puede cambiar el estado o cerrar los mantenimientos que tiene asignados. Lo que registra en `/mantenimientos/realizados` queda a su nombre. Quien tiene "Gestionar mantenimientos e incidencias" puede actuar sobre cualquiera.

### Seguridad — `/seguridad` (Gestionar usuarios, roles y permisos / Consultar bitácora)
| Método | Ruta | Procedimiento |
|---|---|---|
| GET POST PUT PATCH | `/seguridad/empleados`, `/:id`, `/:id/estado` | `sp_ConsultarEmpleados`, `sp_AgregarEmpleado`, `sp_ModificarEmpleado`, `sp_CambiarEstadoEmpleado` |
| GET POST PUT | `/seguridad/usuarios`, `/:id` | listado sin hashes, `sp_CrearUsuarioSistema`, `sp_ModificarUsuarioSistema` |
| GET | `/seguridad/usuarios/bloqueados` | `vw_UsuariosBloqueadosPorIntentos` |
| PUT | `/seguridad/usuarios/:id/contrasena` `{nueva}` | `sp_CambiarContrasenaUsuario` |
| POST | `/seguridad/usuarios/:id/desactivar` · `/reactivar` | `sp_DesactivarUsuarioSistema` · `sp_ReactivarUsuarioSistema` |
| GET | `/seguridad/usuarios/:id/permisos` | `sp_ConsultarPermisosUsuario` |
| GET POST PUT DELETE | `/seguridad/roles`, `/:id` | `sp_ConsultarRoles`, `sp_GestionarRol`, `sp_EliminarRol` |
| GET POST DELETE | `/seguridad/roles/:id/permisos`, `/:idPermiso` | `sp_ConsultarPermisosPorRol`, `sp_AsignarPermisoRol`, `sp_QuitarPermisoRol` |
| GET POST PUT | `/seguridad/permisos`, `/seguridad/modulos` | `sp_ConsultarPermisos`, `sp_GestionarPermiso`, `sp_ConsultarModulos`, `sp_GestionarModulo` |
| GET | `/seguridad/bitacora?...`, `/reciente`, `/resumen?desde&hasta` | `sp_ConsultarBitacora`, `vw_BitacoraReciente`, `sp_ResumirActividadUsuarios` |

### Catálogos — `/catalogos`
Cualquier usuario con sesión puede leerlos. Para modificarlos hace falta el permiso de gestión del módulo al que pertenecen.

`tarifas` (más `/activas`, `/:id/historial` y `POST /simular`), `tipos-tarifa`, `metodos-pago`, `tipos-trabajo`, `tipos-incidencia`, `niveles-alerta`, `reglas-consumo` y `tipos-respaldo`. En todos, `GET` lista, `POST` crea y `PUT /:id` modifica. Tarifas y métodos de pago aceptan además `DELETE /:id`, que es una baja lógica.

### Administración de BD y Data Warehouse
| Método | Ruta | Permiso | Procedimiento |
|---|---|---|---|
| GET POST PUT | `/respaldos/politicas`, `/:id` | Ejecutar respaldos y restauraciones | consulta, `sp_GestionarPoliticaRespaldo` |
| POST | `/respaldos/politicas/:id/ejecutar` | ″ | `sp_EjecutarRespaldo` |
| GET | `/respaldos/historial` | ″ | `sp_ConsultarHistorialRespaldos` |
| POST | `/respaldos/verificar` | ″ | `sp_VerificarIntegridadRespaldos` |
| POST | `/respaldos/restaurar` `{punto_recuperacion, motivo, base_destino?, solo_generar_script?}` | ″ | `sp_RestaurarPuntoEnTiempo` |
| GET | `/respaldos/restauraciones` | ″ | `sp_ConsultarHistorialRestauracion` |
| POST | `/dw/etl` `{carga_completa?}` | Ejecutar ETL | `sp_EjecutarCargaDW` |
| GET | `/dw/etl/control`, `/dw/etl/ultima-carga`, `/dw/etl/fallidas` | Ejecutar ETL | `sp_ConsultarControlETL` y vistas |
| POST | `/dw/etl/:id/reintentar`, `/dw/validar` | Ejecutar ETL | `sp_ReintentarCargaETL`, `sp_ValidarCargaDW` |
| GET | `/dw/conciliar?periodo=AAAAMM` | Ejecutar ETL | `sp_ConciliarOrigenDW` |
| GET | `/dw/consumo?anio&por=mes\|distrito\|tarifa` | Consultar reportes y DW | consulta a `ASADA_DW` |
| GET | `/dw/facturacion?anio` | ″ | facturado vs. recaudado por mes |
| GET | `/dw/morosidad?fecha_corte=AAAAMMDD` | ″ | saldo vencido por distrito |
| GET | `/dw/mantenimientos?anio&por=tipo\|empleado` | ″ | cantidad y días promedio de resolución |
| GET | `/dw/incidencias?anio&por=tipo\|mes\|prioridad&id_tipo_incidencia` | ″ | conteos por estado y días promedio de atención |
| GET | `/bd/monitoreo` | Mantenimiento de BD | `sp_MonitorearBD` |
| POST | `/bd/indices`, `/bd/integridad` | Mantenimiento de BD | `sp_MantenimientoIndices`, `sp_VerificarIntegridadBD` |
| POST | `/pruebas/cargar-datos`, `/pruebas/ejecutar`, `/pruebas/limpiar` | Mantenimiento de BD, solo con `PERMITIR_PRUEBAS=true` | `sp_CargarDatosPrueba`, `sp_EjecutarPruebas`, `sp_LimpiarDatosPrueba` |

## Notas

- **El ETL es incremental.** Toma datos desde la última carga exitosa menos 60 días (`fn_ETL_FechaDesde`). Si se cargan datos con fechas más antiguas, como los de `sp_CargarDatosPrueba` después de un ETL, use `{"carga_completa": true}`.
- **Cerrar sesión.** El token es un JWT de 8 h que no se revoca en el servidor: el cliente lo descarta y el cierre queda registrado en la bitácora. Desactivar al usuario corta su acceso de inmediato.
- **Matriz de acceso.** Según la sección 7, el Administrador del Sistema no consulta el Data Warehouse; ese permiso lo tienen la Junta Directiva y el DBA. Para cambiarlo, asigne el permiso al rol desde `/seguridad/roles/:id/permisos`, sin tocar código.
