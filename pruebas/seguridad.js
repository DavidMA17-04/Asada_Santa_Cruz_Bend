/* Pruebas de sesión, autenticación y bitácora (CU-6.1, CU-6.2, CU-6.7 y CU-6.8).
   Uso:  node pruebas/seguridad.js

   Usa el empleado de prueba 900000097 y el usuario sesion.prueba, que queda
   desactivado al terminar. El límite de intentos se baja a 4 solo para esta prueba. */
process.env.LOGIN_MAX_FALLOS = '4';

const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { cerrarPool } = require('../src/db/conexion');

const ADMIN = { usuario: 'admin', contrasena: 'Asada#2026' };

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

const JUNTA = { usuario: 'junta', contrasena: 'Junta#2026' };
const SESION = { usuario: 'sesion.prueba', contrasena: 'Sesion#2026' };
const NUEVA = 'Cambiada#2026';

// Crea (o reactiva) el usuario de prueba con el rol Fontanero y su contraseña inicial.
async function prepararUsuario(admin) {
  const roles = (await api('GET', '/seguridad/roles', { token: admin })).json.datos;
  const idRol = roles.find((r) => r.nombre_rol === 'Fontanero').id_rol;
  const empleados = await api('GET', '/seguridad/empleados?cedula=900000097', { token: admin });
  let idEmpleado = empleados.json.datos[0]?.id_empleado;
  if (!idEmpleado) {
    const r = await api('POST', '/seguridad/empleados', {
      token: admin,
      cuerpo: { cedula: '900000097', nombre_empleado: 'Sergio', apellido1_empleado: 'Sesion', puesto: 'Fontanero' },
    });
    idEmpleado = r.json.salida.id_empleado;
  } else if (!empleados.json.datos[0].activo) {
    await api('PATCH', `/seguridad/empleados/${idEmpleado}/estado`, { token: admin, cuerpo: { activo: true } });
  }
  const usuarios = (await api('GET', '/seguridad/usuarios', { token: admin })).json.datos;
  const existente = usuarios.find((u) => u.nombre_usuario === SESION.usuario);
  if (!existente) {
    const r = await api('POST', '/seguridad/usuarios', {
      token: admin, cuerpo: { id_empleado: idEmpleado, id_rol: idRol, nombre_usuario: SESION.usuario, contrasena: SESION.contrasena },
    });
    return r.json.salida.id_usuario_sistema;
  }
  await api('POST', `/seguridad/usuarios/${existente.id_usuario_sistema}/reactivar`, { token: admin });
  await api('PUT', `/seguridad/usuarios/${existente.id_usuario_sistema}/contrasena`, { token: admin, cuerpo: { nueva: SESION.contrasena } });
  return existente.id_usuario_sistema;
}

async function ejecutar() {
  const config = require('../src/config');
  // Hora local (la misma que usa GETDATE() en el servidor), un minuto antes de empezar.
  const hace = new Date(Date.now() - 60000);
  const inicio = new Date(hace.getTime() - hace.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

  console.log('\nIniciar sesión (CU-6.1)');
  const r1 = await esperarEstado('Usuario inexistente', 401,
    api('POST', '/auth/login', { cuerpo: { usuario: 'nadie.existe', contrasena: 'Algo#2026' } }));
  const r2 = await esperarEstado('Contraseña incorrecta', 401,
    api('POST', '/auth/login', { cuerpo: { usuario: 'junta', contrasena: 'Incorrecta#1' } }));
  verificar('El mensaje no revela cuál dato falló', r1.json.mensaje === r2.json.mensaje, r2);
  await esperarEstado('Usuario no textual', 400, api('POST', '/auth/login', { cuerpo: { usuario: ['admin'], contrasena: 'x' } }));
  const sesionAdmin = await login(ADMIN);
  const admin = sesionAdmin.token;
  verificar('El login carga rol y permisos', sesionAdmin.usuario.nombre_rol === 'Administrador del Sistema'
    && sesionAdmin.usuario.permisos.includes('Gestionar usuarios, roles y permisos'));
  verificar('La respuesta no incluye el hash de la contraseña', !JSON.stringify(sesionAdmin).includes('contrasena_usuario'));
  const junta = (await login(JUNTA)).token;

  console.log('\nToken');
  const salud = await fetch(`${base}/salud`);
  verificar('Encabezados de seguridad', salud.headers.get('x-content-type-options') === 'nosniff'
    && salud.headers.get('x-frame-options') === 'DENY' && !salud.headers.get('x-powered-by'));
  const datos = jwt.decode(admin);
  verificar('El token tiene identificador (jti) y vencimiento', Boolean(datos.jti && datos.exp));
  const sinFirma = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${admin.split('.')[1]}.`;
  await esperarEstado('Token sin firma (alg none)', 401, api('GET', '/auth/perfil', { token: sinFirma }));
  const otroSecreto = jwt.sign({ usuario: 'admin' }, 'otro-secreto', { subject: '1' });
  await esperarEstado('Token firmado con otro secreto', 401, api('GET', '/auth/perfil', { token: otroSecreto }));
  const vencido = jwt.sign({ usuario: 'admin' }, config.jwt.secreto, { subject: '1', expiresIn: -10 });
  await esperarEstado('Token vencido', 401, api('GET', '/auth/perfil', { token: vencido }));

  console.log('\nCambiar la contraseña propia');
  await prepararUsuario(admin);
  let sesion = (await login(SESION)).token;
  await esperarEstado('Contraseña actual incorrecta', 400,
    api('PUT', '/auth/contrasena', { token: sesion, cuerpo: { actual: 'Otra#2026x', nueva: NUEVA } }));
  await esperarEstado('Nueva contraseña débil', 400,
    api('PUT', '/auth/contrasena', { token: sesion, cuerpo: { actual: SESION.contrasena, nueva: 'corta' } }));
  await esperarEstado('Cambiar la contraseña', 200,
    api('PUT', '/auth/contrasena', { token: sesion, cuerpo: { actual: SESION.contrasena, nueva: NUEVA } }));
  await esperarEstado('La contraseña anterior ya no sirve', 401, api('POST', '/auth/login', { cuerpo: SESION }));
  sesion = (await login({ usuario: SESION.usuario, contrasena: NUEVA })).token;
  verificar('Entra con la contraseña nueva', Boolean(sesion));

  console.log('\nCerrar sesión (CU-6.2)');
  await esperarEstado('Logout', 200, api('POST', '/auth/logout', { token: sesion }));
  await esperarEstado('El token cerrado ya no sirve', 401, api('GET', '/auth/perfil', { token: sesion }));
  await esperarEstado('Las demás sesiones siguen activas', 200, api('GET', '/auth/perfil', { token: admin }));

  console.log('\nBitácora (CU-6.7 y CU-6.8)');
  let r = await esperarEstado('Bitácora de sesiones', 200,
    api('GET', `/seguridad/bitacora?tabla_afectada=Usuario_Sistema&desde=${encodeURIComponent(inicio)}`, { token: admin }));
  for (const accion of ['LOGIN', 'LOGIN_FALLIDO', 'LOGOUT']) {
    verificar(`Registra ${accion}`, r.json.datos.some((b) => b.accion === accion), r);
  }
  verificar('Registra el cambio de contraseña sin guardarla',
    r.json.datos.some((b) => b.descripcion?.includes('cambio de contraseña') && !b.descripcion.includes(NUEVA)), r);
  r = await esperarEstado('Filtro por usuario', 200,
    api('GET', `/seguridad/bitacora?id_usuario_sistema=${sesionAdmin.usuario.id_usuario_sistema}&desde=${encodeURIComponent(inicio)}`, { token: admin }));
  verificar('Solo trae acciones de ese usuario', r.json.datos.length > 0 && r.json.datos.every((b) => b.usuario === 'admin'), r);
  r = await esperarEstado('Filtro sin resultados', 200,
    api('GET', '/seguridad/bitacora?accion=NO_EXISTE', { token: admin }));
  verificar('Devuelve una lista vacía', Array.isArray(r.json.datos) && r.json.datos.length === 0, r);
  await esperarEstado('Resumen sin fechas', 400, api('GET', '/seguridad/bitacora/resumen', { token: admin }));
  await esperarEstado('Resumen por usuario', 200,
    api('GET', `/seguridad/bitacora/resumen?desde=${inicio.slice(0, 10)}&hasta=2999-01-01`, { token: admin }));
  await esperarEstado('Junta Directiva consulta la bitácora', 200, api('GET', '/seguridad/bitacora/reciente', { token: junta }));
  await esperarEstado('Junta Directiva no gestiona usuarios', 403, api('GET', '/seguridad/usuarios', { token: junta }));
  await esperarEstado('Junta Directiva no gestiona roles', 403, api('GET', '/seguridad/roles', { token: junta }));
  await esperarEstado('La bitácora no se modifica desde la API', 404,
    api('DELETE', '/seguridad/bitacora', { token: admin }));

  console.log('\nLímite de intentos por IP');
  for (let i = 1; i <= 4; i += 1) {
    await esperarEstado(`Fallo ${i} con usuarios distintos`, 401,
      api('POST', '/auth/login', { cuerpo: { usuario: `inventado${i}`, contrasena: 'Algo#2026' } }));
  }
  r = await esperarEstado('Al pasar el límite responde 429', 429, api('POST', '/auth/login', { cuerpo: ADMIN }));
  verificar('Indica cuándo reintentar', /minuto/.test(r.json.mensaje), r);

  console.log('\nCierre');
  const usuarios = (await api('GET', '/seguridad/usuarios', { token: admin })).json.datos;
  const id = usuarios.find((u) => u.nombre_usuario === SESION.usuario).id_usuario_sistema;
  await esperarEstado('Desactivar el usuario de prueba', 200, api('POST', `/seguridad/usuarios/${id}/desactivar`, { token: admin }));
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
