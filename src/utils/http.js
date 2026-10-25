const { Contexto } = require('../db/contexto');

class ErrorApi extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

/**
 * Crea un manejador de Express que ejecuta `accion(req, ctx)` con un Contexto
 * del usuario autenticado y responde { ok: true, datos, conjuntos?, salida? }.
 * @param {string[]} permisos  Basta con uno. Vacío = cualquier usuario activo.
 */
function ruta(permisos, accion, { estado = 200 } = {}) {
  return async (req, res, next) => {
    try {
      const ctx = new Contexto(req.usuario, permisos);
      const r = await accion(req, ctx);
      res.status(estado).json({ ok: true, ...r });
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Toma solo las claves permitidas de `origen` (body o query).
 * Omite vacíos para que el procedimiento use sus valores por defecto,
 * y convierte "true"/"false" de la query string a bit.
 */
function tomar(origen = {}, claves) {
  const resultado = {};
  for (const clave of claves) {
    let valor = origen[clave];
    if (valor === undefined || valor === null || valor === '') continue;
    if (typeof valor === 'object') {
      throw new ErrorApi(400, `El campo "${clave}" debe ser un valor simple.`);
    }
    if (valor === 'true') valor = true;
    if (valor === 'false') valor = false;
    resultado[clave] = valor;
  }
  return resultado;
}

/** Valida que un parámetro de la URL sea un id entero positivo. */
function id(valor, nombre = 'id') {
  if (!/^\d{1,9}$/.test(String(valor)) || Number(valor) === 0) {
    throw new ErrorApi(400, `El ${nombre} de la URL debe ser un número entero positivo.`);
  }
  return Number(valor);
}

/** Exige campos en el body antes de llamar a la base, con un mensaje claro. */
function exigir(objeto, campos) {
  const faltantes = campos.filter((c) => objeto[c] === undefined || objeto[c] === null || objeto[c] === '');
  if (faltantes.length) {
    throw new ErrorApi(400, `Faltan campos obligatorios: ${faltantes.join(', ')}.`);
  }
  return objeto;
}

module.exports = { ErrorApi, ruta, tomar, id, exigir };
