/* Ejecuta procedimientos y vistas en nombre del usuario autenticado.

   Los triggers de auditoría leen el usuario de SESSION_CONTEXT, que vive en
   cada conexión. Como el pool reparte conexiones distintas en cada petición,
   todo se envía en un único lote que:
     1. Fija id_usuario_sistema e id_empleado en SESSION_CONTEXT.
     2. Verifica que el usuario y su empleado sigan activos.
     3. Verifica en la base (fn_TienePermiso) que el rol tenga alguno de los
        permisos exigidos. Así, un cambio de rol aplica de inmediato.
     4. Ejecuta el procedimiento o la consulta.

   Los nombres de parámetros y objetos se escriben en el texto del lote, por eso
   solo se aceptan identificadores simples; los valores siempre van como parámetros. */
const { sql, obtenerPool } = require('./conexion');

const IDENTIFICADOR = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validarIdentificador(nombre) {
  if (!IDENTIFICADOR.test(nombre)) {
    throw new Error(`Identificador SQL no válido: ${nombre}`);
  }
}

function encabezado(cantidadPermisos) {
  let texto = `SET DATEFORMAT ymd;
EXEC sys.sp_set_session_context @key = N'id_usuario_sistema', @value = @__uid;
EXEC sys.sp_set_session_context @key = N'id_empleado',        @value = @__emp;
EXEC sys.sp_set_session_context @key = N'comentario',         @value = NULL;
IF NOT EXISTS (SELECT 1
               FROM dbo.Usuario_Sistema u
               JOIN dbo.Empleado e ON e.id_empleado = u.id_empleado
               WHERE u.id_usuario_sistema = @__uid AND u.activo = 1 AND e.activo = 1)
    THROW 50401, 'La sesión no es válida o el usuario fue desactivado.', 1;
`;
  if (cantidadPermisos > 0) {
    const condiciones = Array.from({ length: cantidadPermisos },
      (_, i) => `dbo.fn_TienePermiso(@__uid, @__p${i}) = 1`).join(' OR ');
    texto += `IF NOT (${condiciones})
    THROW 50403, 'No tiene permiso para realizar esta acción.', 1;
`;
  }
  return texto;
}

function resultado(respuesta) {
  const conjuntos = respuesta.recordsets || [];
  const salida = { ...respuesta.output };
  return {
    datos: conjuntos[0] || [],
    ...(conjuntos.length > 1 && { conjuntos }),
    ...(Object.keys(salida).length > 0 && { salida }),
  };
}

class Contexto {
  /**
   * @param {{id_usuario_sistema:number, id_empleado:number}} usuario
   * @param {string[]} permisos  Basta con tener uno de ellos. Vacío = cualquier usuario activo.
   */
  constructor(usuario, permisos = []) {
    this.usuario = usuario;
    this.permisos = permisos;
  }

  /**
   * Ejecuta un lote T-SQL arbitrario (escrito en el código, nunca por el cliente).
   * @param {string} cuerpo
   * @param {Object<string, any>} entradas  Parámetros de entrada.
   * @param {Object<string, any>} salidas   Parámetros OUTPUT: nombre -> tipo de mssql.
   *        Si el mismo nombre viene en entradas, se usa como valor inicial.
   */
  async lote(cuerpo, entradas = {}, salidas = {}) {
    const pool = await obtenerPool();
    const peticion = pool.request();

    peticion.input('__uid', sql.Int, this.usuario.id_usuario_sistema);
    peticion.input('__emp', sql.Int, this.usuario.id_empleado);
    this.permisos.forEach((permiso, i) => peticion.input(`__p${i}`, sql.VarChar(50), permiso));

    for (const [nombre, valor] of Object.entries(entradas)) {
      validarIdentificador(nombre);
      if (!(nombre in salidas)) peticion.input(nombre, valor);
    }
    for (const [nombre, tipo] of Object.entries(salidas)) {
      validarIdentificador(nombre);
      peticion.output(nombre, tipo, entradas[nombre] ?? null);
    }

    return resultado(await peticion.query(encabezado(this.permisos.length) + cuerpo));
  }

  /**
   * Ejecuta dbo.<nombre> pasando cada entrada como @param = @param.
   * @param {{antes?: string, despues?: string}} opciones  T-SQL extra antes del EXEC
   *        (validaciones propias de la API) y después (por ejemplo, registrar en la bitácora).
   */
  sp(nombre, entradas = {}, salidas = {}, { antes = '', despues = '' } = {}) {
    validarIdentificador(nombre);
    const argumentos = [
      ...Object.keys(entradas).filter((k) => !(k in salidas)).map((k) => `@${k} = @${k}`),
      ...Object.keys(salidas).map((k) => `@${k} = @${k} OUTPUT`),
    ];
    return this.lote(`${antes}\nEXEC dbo.${nombre} ${argumentos.join(', ')};\n${despues}`, entradas, salidas);
  }

  /** SELECT * de una vista, con un ORDER BY opcional escrito en el código. */
  vista(nombre, orden = '') {
    validarIdentificador(nombre);
    return this.lote(`SELECT * FROM dbo.${nombre}${orden ? ` ORDER BY ${orden}` : ''};`);
  }
}

module.exports = { Contexto, sql };
