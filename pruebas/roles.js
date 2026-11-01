/* Pruebas del módulo de roles y permisos (CU-6.5 y CU-6.6) contra la base ASADA.
   Uso:  node pruebas/roles.js

   Crea un rol, un módulo y un permiso temporales. El rol se elimina al terminar;
   el módulo y el permiso quedan porque la base no tiene procedimiento para borrarlos. */
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

const P = require('../src/permisos');

async function ejecutar() {
  const sesionAdmin = await login(ADMIN);
  const admin = sesionAdmin.token;
  const sello = Date.now().toString().slice(-6);

  const roles = (await api('GET', '/seguridad/roles', { token: admin })).json.datos;
  const rolDe = (nombre) => roles.find((r) => r.nombre_rol === nombre).id_rol;
  const permisos = (await api('GET', '/seguridad/permisos', { token: admin })).json.datos;
  const permisoDe = (nombre) => permisos.find((p) => p.nombre_permiso === nombre).id_permiso;
  const idAdmin = rolDe('Administrador del Sistema');

  console.log('\nGestionar roles (CU-6.5)');
  let r = await esperarEstado('Crear rol', 201,
    api('POST', '/seguridad/roles', { token: admin, cuerpo: { nombre_rol: `  Rol prueba ${sello}  ` } }));
  const idRol = r.json.salida.id_rol;
  r = await api('GET', '/seguridad/roles', { token: admin });
  verificar('El nombre se guarda sin espacios sobrantes', r.json.datos.some((x) => x.nombre_rol === `Rol prueba ${sello}`), r);
  await esperarEstado('Rol duplicado', 400,
    api('POST', '/seguridad/roles', { token: admin, cuerpo: { nombre_rol: `Rol prueba ${sello}` } }));
  await esperarEstado('Rol sin nombre', 400, api('POST', '/seguridad/roles', { token: admin, cuerpo: { nombre_rol: '   ' } }));
  r = await esperarEstado('Nombre de rol de más de 25 caracteres', 400,
    api('POST', '/seguridad/roles', { token: admin, cuerpo: { nombre_rol: 'Un nombre de rol demasiado largo' } }));
  verificar('No se trunca en silencio', /25/.test(r.json.mensaje), r);
  await esperarEstado('Renombrar rol propio', 200,
    api('PUT', `/seguridad/roles/${idRol}`, { token: admin, cuerpo: { nombre_rol: `Rol renombrado ${sello}` } }));
  await esperarEstado('No se renombra un rol base', 400,
    api('PUT', `/seguridad/roles/${rolDe('Fontanero')}`, { token: admin, cuerpo: { nombre_rol: 'Plomero' } }));
  await esperarEstado('Guardar un rol base con su mismo nombre sí se permite', 200,
    api('PUT', `/seguridad/roles/${rolDe('Fontanero')}`, { token: admin, cuerpo: { nombre_rol: 'Fontanero' } }));
  await esperarEstado('No se elimina un rol base', 400,
    api('DELETE', `/seguridad/roles/${rolDe('Junta Directiva')}`, { token: admin }));

  console.log('\nAsignar permisos a un rol (CU-6.6)');
  const idConsultarBitacora = permisoDe(P.CONSULTAR_BITACORA);
  await esperarEstado('Asignar permiso', 201,
    api('POST', `/seguridad/roles/${idRol}/permisos`, { token: admin, cuerpo: { id_permiso: idConsultarBitacora } }));
  await esperarEstado('Asignar el mismo permiso dos veces', 400,
    api('POST', `/seguridad/roles/${idRol}/permisos`, { token: admin, cuerpo: { id_permiso: idConsultarBitacora } }));
  r = await esperarEstado('Matriz de permisos del rol', 200, api('GET', `/seguridad/roles/${idRol}/matriz`, { token: admin }));
  verificar('La matriz trae todos los permisos', r.json.datos.length === permisos.length, r);
  verificar('La matriz marca solo el permiso asignado',
    r.json.datos.filter((p) => p.asignado).map((p) => p.nombre_permiso).join() === P.CONSULTAR_BITACORA, r);
  await esperarEstado('Matriz de un rol inexistente', 400, api('GET', '/seguridad/roles/999999/matriz', { token: admin }));
  await esperarEstado('No se elimina un rol con permisos', 400, api('DELETE', `/seguridad/roles/${idRol}`, { token: admin }));
  await esperarEstado('Quitar permiso', 200,
    api('DELETE', `/seguridad/roles/${idRol}/permisos/${idConsultarBitacora}`, { token: admin }));

  r = await esperarEstado('El Administrador no pierde "Gestionar usuarios, roles y permisos"', 400,
    api('DELETE', `/seguridad/roles/${idAdmin}/permisos/${permisoDe(P.GESTIONAR_SEGURIDAD)}`, { token: admin }));
  verificar('El error usa el código 50533', r.json.codigo === 50533, r);
  await esperarEstado('El Administrador no pierde "Consultar bitácora"', 400,
    api('DELETE', `/seguridad/roles/${idAdmin}/permisos/${idConsultarBitacora}`, { token: admin }));
  r = await api('GET', `/seguridad/roles/${idAdmin}/permisos`, { token: admin });
  verificar('El rol Administrador conserva sus permisos de seguridad',
    [P.GESTIONAR_SEGURIDAD, P.CONSULTAR_BITACORA].every((n) => r.json.datos.some((p) => p.nombre_permiso === n)), r);
  await esperarEstado('Quitar un permiso no funcional del Administrador sí se permite', 200,
    api('DELETE', `/seguridad/roles/${idAdmin}/permisos/${permisoDe(P.REGISTRAR_LECTURA)}`, { token: admin }));
  await esperarEstado('Y se puede devolver', 201,
    api('POST', `/seguridad/roles/${idAdmin}/permisos`, { token: admin, cuerpo: { id_permiso: permisoDe(P.REGISTRAR_LECTURA) } }));

  console.log('\nMódulos y permisos');
  r = await esperarEstado('Crear módulo', 201,
    api('POST', '/seguridad/modulos', { token: admin, cuerpo: { nombre_modulo: `Módulo prueba ${sello}` } }));
  const idModulo = r.json.salida.id_modulo;
  r = await esperarEstado('Crear permiso', 201, api('POST', '/seguridad/permisos', {
    token: admin, cuerpo: { id_modulo: idModulo, nombre_permiso: `Permiso prueba ${sello}` },
  }));
  const idPermiso = r.json.salida.id_permiso;
  await esperarEstado('Permiso sin módulo', 400,
    api('POST', '/seguridad/permisos', { token: admin, cuerpo: { nombre_permiso: `Otro ${sello}` } }));
  await esperarEstado('Renombrar un permiso propio', 200, api('PUT', `/seguridad/permisos/${idPermiso}`, {
    token: admin, cuerpo: { id_modulo: idModulo, nombre_permiso: `Permiso renombrado ${sello}` },
  }));
  const gestionar = permisos.find((p) => p.nombre_permiso === P.GESTIONAR_SEGURIDAD);
  await esperarEstado('No se renombra un permiso que usa la API', 400, api('PUT', `/seguridad/permisos/${gestionar.id_permiso}`, {
    token: admin, cuerpo: { id_modulo: gestionar.id_modulo, nombre_permiso: 'Otro nombre' },
  }));

  console.log('\nAuditoría');
  r = await esperarEstado('Bitácora de Rol', 200, api('GET', '/seguridad/bitacora?tabla_afectada=Rol', { token: admin }));
  verificar('Registra el alta del rol', r.json.datos.some((b) => b.accion === 'INSERT' && b.descripcion.includes(`Rol prueba ${sello}`)), r);
  verificar('Registra el cambio de nombre', r.json.datos.some((b) => b.accion === 'UPDATE' && b.descripcion.includes(`Rol renombrado ${sello}`)), r);
  verificar('A nombre del admin', r.json.datos.filter((b) => b.descripcion.includes(sello)).every((b) => b.usuario === ADMIN.usuario), r);
  r = await esperarEstado('Bitácora de Rol_permiso', 200, api('GET', '/seguridad/bitacora?tabla_afectada=Rol_permiso', { token: admin }));
  verificar('Registra la asignación y el retiro del permiso',
    ['INSERT', 'DELETE'].every((a) => r.json.datos.some((b) => b.accion === a && b.descripcion.includes(`Rol renombrado ${sello}`))), r);
  r = await api('GET', '/seguridad/bitacora?tabla_afectada=Permiso', { token: admin });
  verificar('Registra el alta del permiso', r.json.datos.some((b) => b.descripcion.includes(`Permiso prueba ${sello}`)), r);

  console.log('\nCierre');
  await esperarEstado('Eliminar el rol de prueba', 200, api('DELETE', `/seguridad/roles/${idRol}`, { token: admin }));
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
