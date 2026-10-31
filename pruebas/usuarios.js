/* Pruebas del módulo de usuarios del sistema (CU-6.3 y CU-6.4) contra la base ASADA.
   Uso:  node pruebas/usuarios.js

   Usa el empleado de prueba 900000098 y el usuario operador.prueba. Se pueden
   ejecutar varias veces: al terminar el usuario de prueba queda desactivado. */
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

const OPERADOR = { usuario: 'operador.prueba', contrasena: 'Operador#2026' };

// Crea (o reactiva) el usuario de prueba con el rol indicado.
async function prepararOperador(admin, idRol) {
  let empleados = await api('GET', '/seguridad/empleados?cedula=900000098', { token: admin });
  let idEmpleado = empleados.json.datos[0]?.id_empleado;
  if (!idEmpleado) {
    const r = await api('POST', '/seguridad/empleados', {
      token: admin,
      cuerpo: { cedula: '900000098', nombre_empleado: 'Olga', apellido1_empleado: 'Prueba', puesto: 'Operadora' },
    });
    idEmpleado = r.json.salida.id_empleado;
  } else if (!empleados.json.datos[0].activo) {
    await api('PATCH', `/seguridad/empleados/${idEmpleado}/estado`, { token: admin, cuerpo: { activo: true } });
  }

  const usuarios = await api('GET', '/seguridad/usuarios', { token: admin });
  let operador = usuarios.json.datos.find((u) => u.nombre_usuario === OPERADOR.usuario);
  if (operador) {
    if (!operador.activo || operador.intentos_fallidos) {
      await api('POST', `/seguridad/usuarios/${operador.id_usuario_sistema}/reactivar`, { token: admin });
    }
    await api('PUT', `/seguridad/usuarios/${operador.id_usuario_sistema}`, { token: admin, cuerpo: { id_rol: idRol } });
    await api('PUT', `/seguridad/usuarios/${operador.id_usuario_sistema}/contrasena`,
      { token: admin, cuerpo: { nueva: OPERADOR.contrasena } });
    return { idEmpleado, idUsuario: operador.id_usuario_sistema };
  }
  const r = await esperarEstado('Crear usuario de prueba', 201, api('POST', '/seguridad/usuarios', {
    token: admin,
    cuerpo: { id_empleado: idEmpleado, id_rol: idRol, nombre_usuario: OPERADOR.usuario, contrasena: OPERADOR.contrasena },
  }));
  return { idEmpleado, idUsuario: r.json.salida.id_usuario_sistema };
}

async function ejecutar() {
  const sesionAdmin = await login(ADMIN);
  const admin = sesionAdmin.token;
  const yo = sesionAdmin.usuario;

  const roles = (await api('GET', '/seguridad/roles', { token: admin })).json.datos;
  const rolDe = (nombre) => roles.find((r) => r.nombre_rol === nombre).id_rol;
  const { idEmpleado, idUsuario } = await prepararOperador(admin, rolDe('Fontanero'));

  console.log('\nProtección de la cuenta propia');
  let r = await esperarEstado('Admin no puede desactivarse a sí mismo', 400,
    api('POST', `/seguridad/usuarios/${yo.id_usuario_sistema}/desactivar`, { token: admin }));
  verificar('El error usa el código 50530', r.json.codigo === 50530, r);
  await esperarEstado('Admin no puede cambiar su propio rol', 400,
    api('PUT', `/seguridad/usuarios/${yo.id_usuario_sistema}`, { token: admin, cuerpo: { id_rol: rolDe('Fontanero') } }));
  await esperarEstado('Admin no puede desactivar su propio empleado', 400,
    api('PATCH', `/seguridad/empleados/${yo.id_empleado}/estado`, { token: admin, cuerpo: { activo: false } }));
  r = await esperarEstado('Su sesión sigue funcionando', 200, api('GET', '/seguridad/usuarios', { token: admin }));
  // El driver puede devolver los id como texto; se comparan como número.
  verificar('Su cuenta sigue activa con su rol', r.json.datos.some((u) =>
    Number(u.id_usuario_sistema) === Number(yo.id_usuario_sistema) && u.activo && Number(u.id_rol) === Number(yo.id_rol)), r);

  console.log('\nAlta y validaciones (CU-6.4)');
  await esperarEstado('Nombre de usuario duplicado', 400, api('POST', '/seguridad/usuarios', {
    token: admin,
    cuerpo: { id_empleado: idEmpleado, id_rol: rolDe('Fontanero'), nombre_usuario: 'admin', contrasena: 'Valida#2026x' },
  }));
  await esperarEstado('Contraseña débil al restablecer', 400,
    api('PUT', `/seguridad/usuarios/${idUsuario}/contrasena`, { token: admin, cuerpo: { nueva: 'debil' } }));
  await esperarEstado('Restablecer sin contraseña', 400,
    api('PUT', `/seguridad/usuarios/${idUsuario}/contrasena`, { token: admin, cuerpo: {} }));

  console.log('\nPermisos por rol');
  let operador = (await login(OPERADOR)).token;
  await esperarEstado('Fontanero no gestiona usuarios', 403, api('GET', '/seguridad/usuarios', { token: operador }));
  await esperarEstado('Fontanero no consulta la bitácora', 403, api('GET', '/seguridad/bitacora', { token: operador }));
  await esperarEstado('Cambiar el rol a Junta Directiva', 200,
    api('PUT', `/seguridad/usuarios/${idUsuario}`, { token: admin, cuerpo: { id_rol: rolDe('Junta Directiva') } }));
  await esperarEstado('El cambio aplica con el mismo token: Junta consulta la bitácora', 200,
    api('GET', '/seguridad/bitacora/reciente', { token: operador }));
  await esperarEstado('Junta sigue sin gestionar usuarios', 403, api('GET', '/seguridad/usuarios', { token: operador }));
  r = await esperarEstado('Permisos efectivos del usuario', 200,
    api('GET', `/seguridad/usuarios/${idUsuario}/permisos`, { token: admin }));
  verificar('Los permisos son los de Junta Directiva', r.json.datos.every((p) => p.nombre_rol === 'Junta Directiva'), r);

  console.log('\nDesactivar y reactivar');
  await esperarEstado('Desactivar al usuario', 200,
    api('POST', `/seguridad/usuarios/${idUsuario}/desactivar`, { token: admin }));
  await esperarEstado('Su token deja de servir de inmediato', 401, api('GET', '/auth/perfil', { token: operador }));
  await esperarEstado('No puede iniciar sesión', 403, api('POST', '/auth/login', { cuerpo: OPERADOR }));
  await esperarEstado('Reactivar al usuario', 200,
    api('POST', `/seguridad/usuarios/${idUsuario}/reactivar`, { token: admin }));
  operador = (await login(OPERADOR)).token;
  verificar('Vuelve a iniciar sesión', Boolean(operador));

  console.log('\nBloqueo por intentos fallidos');
  for (let i = 1; i <= 3; i += 1) {
    await esperarEstado(`Intento fallido ${i}`, 401,
      api('POST', '/auth/login', { cuerpo: { usuario: OPERADOR.usuario, contrasena: 'Incorrecta#1' } }));
  }
  await esperarEstado('Con la contraseña correcta ya está bloqueado', 403, api('POST', '/auth/login', { cuerpo: OPERADOR }));
  r = await esperarEstado('Lista de usuarios bloqueados', 200, api('GET', '/seguridad/usuarios/bloqueados', { token: admin }));
  verificar('Aparece en la lista de bloqueados', JSON.stringify(r.json.datos).includes(OPERADOR.usuario), r);
  await esperarEstado('Reactivar desbloquea la cuenta', 200,
    api('POST', `/seguridad/usuarios/${idUsuario}/reactivar`, { token: admin }));
  await esperarEstado('Inicia sesión después del desbloqueo', 200, api('POST', '/auth/login', { cuerpo: OPERADOR }));

  console.log('\nEmpleado y auditoría');
  await esperarEstado('Desactivar el empleado también desactiva su usuario', 200,
    api('PATCH', `/seguridad/empleados/${idEmpleado}/estado`, { token: admin, cuerpo: { activo: false } }));
  await esperarEstado('El usuario ya no inicia sesión', 403, api('POST', '/auth/login', { cuerpo: OPERADOR }));
  r = await esperarEstado('Bitácora de Usuario_Sistema', 200,
    api('GET', `/seguridad/bitacora?tabla_afectada=Usuario_Sistema&id_usuario_sistema=${yo.id_usuario_sistema}`, { token: admin }));
  verificar('La bitácora registra la desactivación a nombre del admin',
    r.json.datos.some((b) => b.usuario === ADMIN.usuario && b.descripcion.includes(OPERADOR.usuario) && b.descripcion.includes('desactivado')), r);
  verificar('La bitácora nunca muestra el hash de la contraseña',
    !r.json.datos.some((b) => /[0-9A-F]{64}/i.test(b.descripcion || '')), r);
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
