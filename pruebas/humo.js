/* Prueba de humo de la API contra la base ASADA real.
   Uso:  npm run prueba     (requiere PERMITIR_PRUEBAS=true en .env para limpiar al final)

   Crea datos con la convención de 18_pruebas.sql (correo @prueba.asada, medidor PRB-*,
   empleado 9000000*) para que sp_LimpiarDatosPrueba los elimine al terminar. */
const app = require('../src/app');
const config = require('../src/config');
const { cerrarPool } = require('../src/db/conexion');

const ADMIN = { usuario: 'admin', contrasena: 'Asada#2026' };
const DBA = { usuario: 'dba', contrasena: 'AsadaDBA#2026' };
const FONTANERO = { usuario: 'fontanero.prueba', contrasena: 'Fontanero#2026' };

let base;
let fallos = 0;
let total = 0;

async function api(metodo, ruta, { token, cuerpo } = {}) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { estado: respuesta.status, json: await respuesta.json() };
}

function verificar(nombre, condicion, r) {
  total += 1;
  if (condicion) {
    console.log(`  ok   ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  FALLA ${nombre}\n        -> ${r ? `${r.estado} ${JSON.stringify(r.json).slice(0, 400)}` : ''}`);
  }
}

async function esperarEstado(nombre, estado, promesa) {
  const r = await promesa;
  verificar(`${nombre} (${estado})`, r.estado === estado, r);
  return r;
}

async function login(credenciales) {
  const r = await api('POST', '/auth/login', { cuerpo: credenciales });
  if (r.estado !== 200) throw new Error(`No se pudo iniciar sesión como ${credenciales.usuario}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function prepararFontanero(admin) {
  const roles = await api('GET', '/seguridad/roles', { token: admin });
  const idRol = roles.json.datos.find((r) => r.nombre_rol === 'Fontanero').id_rol;

  let empleados = await api('GET', '/seguridad/empleados?cedula=900000099', { token: admin });
  let idEmpleado = empleados.json.datos[0]?.id_empleado;
  if (!idEmpleado) {
    const r = await api('POST', '/seguridad/empleados', {
      token: admin,
      cuerpo: { cedula: '900000099', nombre_empleado: 'Pedro', apellido1_empleado: 'Humo', puesto: 'Fontanero' },
    });
    idEmpleado = r.json.salida.id_empleado;
  }

  const usuarios = await api('GET', '/seguridad/usuarios', { token: admin });
  const existente = usuarios.json.datos.find((u) => u.nombre_usuario === FONTANERO.usuario);
  if (existente) {
    await api('POST', `/seguridad/usuarios/${existente.id_usuario_sistema}/reactivar`, { token: admin });
  } else {
    await esperarEstado('Crear usuario fontanero', 201, api('POST', '/seguridad/usuarios', {
      token: admin,
      cuerpo: { id_empleado: idEmpleado, id_rol: idRol, nombre_usuario: FONTANERO.usuario, contrasena: FONTANERO.contrasena },
    }));
  }
  return idEmpleado;
}

async function ejecutar() {
  const sello = Date.now().toString().slice(-8);
  const cedula = `5${sello}`;

  console.log('\nSesión');
  await esperarEstado('Salud de la API', 200, api('GET', '/salud'));
  await esperarEstado('Login con usuario inexistente', 401, api('POST', '/auth/login', { cuerpo: { usuario: 'no_existe', contrasena: 'x' } }));
  await esperarEstado('Ruta protegida sin token', 401, api('GET', '/abonados'));
  const sesionAdmin = await login(ADMIN);
  const admin = sesionAdmin.token;
  verificar('Login admin devuelve permisos', sesionAdmin.usuario.permisos.length > 0);
  await esperarEstado('Perfil', 200, api('GET', '/auth/perfil', { token: admin }));
  await esperarEstado('Admin no consulta el DW (matriz de acceso)', 403, api('GET', '/dw/consumo', { token: admin }));

  console.log('\nCatálogos');
  const tarifas = await esperarEstado('Tarifas', 200, api('GET', '/catalogos/tarifas?solo_activas=true', { token: admin }));
  const metodos = await esperarEstado('Métodos de pago', 200, api('GET', '/catalogos/metodos-pago', { token: admin }));
  const tiposInc = await esperarEstado('Tipos de incidencia', 200, api('GET', '/catalogos/tipos-incidencia', { token: admin }));
  const tiposTrab = await esperarEstado('Tipos de trabajo', 200, api('GET', '/catalogos/tipos-trabajo', { token: admin }));
  const idTarifa = tarifas.json.datos[0].id_tarifa;
  const idMetodo = metodos.json.datos[0].id_metodo_pago;
  const idTipoInc = tiposInc.json.datos[0].id_tipo_incidencia;
  const idTipoTrab = tiposTrab.json.datos[0].id_tipo_trabajo;

  console.log('\nAbonados, conexión y medidor');
  const nuevo = await esperarEstado('Registrar abonado físico', 201, api('POST', '/abonados', {
    token: admin,
    cuerpo: {
      tipo_identificacion: 'FISICA', numero_identidad: cedula, nombre: 'María', apellido1: 'Humo',
      fecha_nacimiento: '1990-05-10', direccion: 'Nicoya, Barrio La Cananga', correo_electronico: `humo${sello}@prueba.asada`,
    },
  }));
  const idAbonado = nuevo.json.salida?.id_abonado;
  await esperarEstado('Abonado duplicado se rechaza', 400, api('POST', '/abonados', {
    token: admin,
    cuerpo: { tipo_identificacion: 'FISICA', numero_identidad: cedula, nombre: 'X', apellido1: 'Y', direccion: 'Z' },
  }));
  const buscado = await esperarEstado('Consultar abonado por identificación', 200, api('GET', `/abonados?identificacion=${cedula}`, { token: admin }));
  verificar('La consulta encuentra al abonado', buscado.json.datos.length >= 1, buscado);
  await esperarEstado('Modificar abonado', 200, api('PUT', `/abonados/FISICO/${idAbonado}`, { token: admin, cuerpo: { telefono: '2685-0000' } }));

  const conexion = await esperarEstado('Registrar conexión', 201, api('POST', '/conexiones', {
    token: admin, cuerpo: { tipo_abonado: 'FISICO', id_abonado: idAbonado, id_tarifa: idTarifa, ubicacion: 'Nicoya, centro' },
  }));
  const idConexion = conexion.json.salida?.id_conexion;
  const medidor = await esperarEstado('Asignar medidor', 201, api('POST', `/conexiones/${idConexion}/medidor`, {
    token: admin, cuerpo: { numero_serie: `PRB-H${sello}`, lectura_inicial: 100 },
  }));
  const idMedidor = medidor.json.salida?.id_medidor;

  console.log('\nLectura, factura y pagos');
  const lectura = await esperarEstado('Registrar lectura', 201, api('POST', '/lecturas', {
    token: admin, cuerpo: { id_medidor: idMedidor, lectura_actual: 118 },
  }));
  verificar('Consumo calculado = 18 m³', Number(lectura.json.salida?.consumo) === 18, lectura);
  const factura = await esperarEstado('Generar factura', 201, api('POST', '/facturas', {
    token: admin, cuerpo: { id_lectura: lectura.json.salida?.id_lectura },
  }));
  const idFactura = factura.json.salida?.id_factura;
  const saldo = await esperarEstado('Saldo de la factura', 200, api('GET', `/facturas/${idFactura}/saldo`, { token: admin }));
  const pago = await esperarEstado('Pago parcial', 201, api('POST', '/pagos', {
    token: admin, cuerpo: { id_factura: idFactura, id_metodo_pago: idMetodo, monto: 1000 },
  }));
  await esperarEstado('Anular pago', 200, api('POST', `/pagos/${pago.json.salida?.id_pago}/anular`, {
    token: admin, cuerpo: { motivo: 'Prueba de humo' },
  }));
  const montoExcesivo = Number(saldo.json.datos[0]?.saldo_pendiente ?? 1e6) + 1e6;
  await esperarEstado('Pago mayor al saldo se rechaza', 400, api('POST', '/pagos', {
    token: admin, cuerpo: { id_factura: idFactura, id_metodo_pago: idMetodo, monto: montoExcesivo },
  }));

  console.log('\nAuditoría (SESSION_CONTEXT)');
  const bitacora = await esperarEstado('Consultar bitácora', 200, api('GET', '/seguridad/bitacora?tabla_afectada=Abonado_Fisico', { token: admin }));
  verificar('La bitácora atribuye el alta del abonado a "admin"',
    bitacora.json.datos.some((b) => b.usuario === 'admin' && String(b.descripcion).includes(String(idAbonado))), bitacora);

  console.log('\nFontanero');
  const idEmpleadoFontanero = await prepararFontanero(admin);
  const fontanero = (await login(FONTANERO)).token;
  await esperarEstado('Fontanero no ve abonados', 403, api('GET', '/abonados', { token: fontanero }));
  await esperarEstado('Fontanero ve medidores sin lectura', 200, api('GET', '/medidores/sin-lectura', { token: fontanero }));
  const incidencia = await esperarEstado('Fontanero registra incidencia', 201, api('POST', '/incidencias', {
    token: fontanero, cuerpo: { id_medidor: idMedidor, id_tipo_incidencia: idTipoInc, descripcion: 'Fuga en la acometida (humo)' },
  }));
  const idIncidencia = incidencia.json.salida?.id_incidencia;

  const ajeno = await esperarEstado('Admin programa mantenimiento para sí mismo', 201, api('POST', '/mantenimientos', {
    token: admin,
    cuerpo: { id_empleado: sesionAdmin.usuario.id_empleado, id_tipo_trabajo: idTipoTrab, id_conexion: idConexion, descripcion: 'Revisión (humo)' },
  }));
  await esperarEstado('Fontanero no modifica mantenimiento ajeno', 403, api('PATCH', `/mantenimientos/${ajeno.json.salida?.id_mantenimiento}/estado`, {
    token: fontanero, cuerpo: { nuevo_estado: 'En proceso' },
  }));
  const propio = await esperarEstado('Admin asigna la incidencia al fontanero', 201, api('POST', `/incidencias/${idIncidencia}/mantenimiento`, {
    token: admin, cuerpo: { id_empleado: idEmpleadoFontanero, id_tipo_trabajo: idTipoTrab },
  }));
  const idMant = propio.json.salida?.id_mantenimiento;
  await esperarEstado('Fontanero inicia su mantenimiento', 200, api('PATCH', `/mantenimientos/${idMant}/estado`, {
    token: fontanero, cuerpo: { nuevo_estado: 'En proceso', anotacion: 'Llegué al sitio' },
  }));
  await esperarEstado('Fontanero cierra su mantenimiento', 200, api('POST', `/mantenimientos/${idMant}/cerrar`, {
    token: fontanero, cuerpo: { detalle: 'Se cambió el tubo dañado' },
  }));
  const historial = await esperarEstado('Historial del mantenimiento', 200, api('GET', `/mantenimientos/${idMant}/historial`, { token: fontanero }));
  verificar('El historial registra al fontanero como autor', JSON.stringify(historial.json.datos).includes('Pedro'), historial);

  console.log('\nAdministrador de BD y Data Warehouse');
  const dba = (await login(DBA)).token;
  await esperarEstado('DBA no gestiona abonados', 403, api('GET', '/abonados', { token: dba }));
  await esperarEstado('Ejecutar ETL', 200, api('POST', '/dw/etl', { token: dba, cuerpo: {} }));
  await esperarEstado('Control del ETL', 200, api('GET', '/dw/etl/control', { token: dba }));
  for (const ruta of ['/dw/consumo?por=mes', '/dw/consumo?por=distrito', '/dw/consumo?por=tarifa', '/dw/facturacion',
    '/dw/morosidad', '/dw/mantenimientos?por=tipo', '/dw/mantenimientos?por=empleado']) {
    await esperarEstado(`DW ${ruta}`, 200, api('GET', ruta, { token: dba }));
  }
  await esperarEstado('Parámetro inválido en el DW', 400, api('GET', '/dw/consumo?por=color', { token: dba }));
  await esperarEstado('Monitoreo de la BD', 200, api('GET', '/bd/monitoreo', { token: dba }));
  await esperarEstado('Políticas de respaldo', 200, api('GET', '/respaldos/politicas', { token: dba }));

  console.log('\nCierre');
  await esperarEstado('Logout', 200, api('POST', '/auth/logout', { token: admin }));
  if (config.permitirPruebas) {
    await esperarEstado('Limpiar datos de prueba', 200, api('POST', '/pruebas/limpiar', { token: dba }));
  } else {
    console.log('  (PERMITIR_PRUEBAS=false: no se limpiaron los datos; ejecute EXEC dbo.sp_LimpiarDatosPrueba)');
  }
  const admin2 = (await login(ADMIN)).token;
  const usuarios = await api('GET', '/seguridad/usuarios', { token: admin2 });
  const idFontanero = usuarios.json.datos.find((u) => u.nombre_usuario === FONTANERO.usuario)?.id_usuario_sistema;
  if (idFontanero) await api('POST', `/seguridad/usuarios/${idFontanero}/desactivar`, { token: admin2 });
}

const servidor = app.listen(0, async () => {
  base = `http://127.0.0.1:${servidor.address().port}/api`;
  try {
    await ejecutar();
  } catch (err) {
    fallos += 1;
    console.error('\nError inesperado:', err);
  } finally {
    console.log(`\n${total - fallos}/${total} verificaciones correctas`);
    servidor.close();
    await cerrarPool();
    process.exit(fallos ? 1 : 0);
  }
});
