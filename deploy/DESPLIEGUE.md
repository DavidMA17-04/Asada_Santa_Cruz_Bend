# Guía de despliegue — ASADA Santa Cruz

Documento principal para instalar o actualizar el sistema en otra computadora.

## 1. Requisitos previos

| Componente | Detalle |
|------------|---------|
| SO | Windows 10/11 |
| SQL Server | 2019 o superior. **Developer** o **Standard** si necesitan SQL Server Agent y respaldos programados. **Express** funciona para la aplicación web, pero **no** incluye Agent. |
| Herramientas | SSMS o `sqlcmd`, ODBC Driver 17/18 |
| Node.js | 20 o superior |
| Permisos | Usuario Windows con acceso a SQL (`sysadmin` o login configurado). Admin Windows recomendado para ACL en carpetas de respaldo y Agent. |
| Disco | Espacio para datos SQL (por defecto `c:\sqldata`, `c:\sqllog`) y `C:\Respaldos\...` |

## 2. Estructura exacta de carpetas

Clone los tres repositorios de GitHub (rama `development`) **con estos nombres de carpeta**:

```powershell
mkdir C:\ASADA
cd C:\ASADA
git clone -b development https://github.com/DavidMA17-04/Asada_Santa_Cruz_Bend.git backend
git clone -b development https://github.com/DavidMA17-04/Asada_Santa_Cruz_Fend.git frontend
git clone -b development https://github.com/DavidMA17-04/Proyecto_Admin_DB_Scripts.git sql
```

Scripts SQL: `sql\sql\*.sql`  
Instalador versionado: `backend\deploy\`

## 3. Instalación nueva (Escenario A)

Cuando **no** existe la base `ASADA`.

```powershell
cd C:\ASADA\backend\deploy
.\instalar.ps1 -Servidor "localhost"
```

Con demo y jobs (opcional):

```powershell
.\instalar.ps1 -Servidor "localhost" -CargarDemo -InstalarJobs
```

Rutas personalizadas (solo afecta **instalación nueva**):

```powershell
.\instalar.ps1 `
  -RutaDatos "D:\SQL\Data" `
  -RutaLog "D:\SQL\Log" `
  -RutaRespaldosASADA "D:\Respaldos\ASADA\" `
  -RutaRespaldosASADA_DW "D:\Respaldos\ASADA_DW\"
```

El instalador:

1. Comprueba Node, sqlcmd, ODBC.
2. Detecta instancia SQL o usa `-Servidor`.
3. Informa edición y disponibilidad de Agent (sin iniciarlo).
4. Crea carpetas de respaldo y ACL para `NT SERVICE\<servicio SQL>`.
5. Ejecuta `ejecutar_todo.sql` con variables de ruta.
6. Opcionalmente demo y jobs deshabilitados.
7. `npm install`, `npm run build`, crea `backend\.env` si no existe.

**Rechazo explícito:** si `ASADA` ya existe, `instalar.ps1` termina con error (use actualización).

## 4. Actualización (Escenario B)

Cuando **ya** existen `ASADA` y `ASADA_DW` con datos.

```powershell
cd backend\deploy
.\actualizar.ps1 -Servidor "localhost"
```

Primera ejecución: solo diagnóstico y lista de migraciones pendientes (`actualizar_a_development.sql`, `22_migracion_respaldos_dw.sql`).

Para aplicar migraciones:

1. Realice respaldo comprobable de ASADA (y ASADA_DW).
2. Ejecute:

```powershell
.\actualizar.ps1 -Servidor "localhost" `
  -ConfirmarMigracion `
  -ConfirmarRespaldoComprobable `
  -InstalarJobsFaltantes
```

Registro en `backend\deploy\log\actualizar_*.log`.

**Nunca** se ejecuta `ejecutar_todo.sql` en modo actualización.

### Jobs en actualización

- No se ejecuta `17_jobs_sql_agent.sql` completo (recrearía jobs).
- `-InstalarJobsFaltantes` instala solo `Job_RespaldoCompletoDW` si falta, e informa otros faltantes.

## 5. Configuración SQL Server

- Autenticación **Windows** (predeterminado): la cuenta que ejecuta `npm start` debe poder conectar a SQL.
- Autenticación **SQL**: en `backend\.env`, `DB_AUTENTICACION=sql` y usuario/contraseña.
- **Agent:** configurar inicio y servicio manualmente si desean jobs; el proyecto no lo hace automáticamente.
- Políticas de respaldo usan rutas en `Politica_Respaldo`; al migrar 22, puede pasar `-RutaRespaldosASADA_DW`.

## 6. Backend (`backend\.env`)

Copiar de `.env.example`. El instalador rellena `DB_SERVIDOR`, `DB_DRIVER`, `JWT_SECRETO`.

| Variable | Uso |
|----------|-----|
| `PUERTO` | 3000 por defecto |
| `DB_SERVIDOR` | `localhost` o `localhost\SQLEXPRESS` |
| `CORS_ORIGEN` | En producción same-origin (3000) no es crítico; en dev Vite usar `http://localhost:5173` |
| `PERMITIR_PRUEBAS` | `false` en exposición |

## 7. Frontend

Se compila con `npm run build`; la API sirve `frontend/dist` en el puerto del backend.

## 8. Datos demo

Script: `sql\sql\19_datos_demo.sql`. Opción `-CargarDemo` en instalación nueva.

- Detecta medidores `SC-` y aborta si ya existen.
- Incluye ETL completo al final.
- Tras cargar, `verificar.ps1` / `sp_ValidarCargaDW` deben reportar OK.

No sustituye copiar `.bak` de otra máquina (rutas y servidor distintos).

## 9. Verificación

```powershell
.\verificar.ps1 -Servidor "localhost"
```

SQL: `sql\sql\verificar_instalacion.sql` (OK / Advertencia / Error).

## 10. Acceso en red local

1. Inicie con `INICIAR.bat`.
2. En consola aparecen URLs `http://<IP>:3000/`.
3. Firewall Windows: regla entrante **TCP 3000** (perfil Privado).
4. Clientes usan `http://<IP_servidor>:3000/` (mismo origen, sin CORS extra).

## 11. Día de la exposición

1. Verificar SQL y Agent (si aplica) en ejecución.
2. `deploy\verificar.ps1` sin errores críticos.
3. `deploy\INICIAR.bat`; dejar ventana abierta.
4. Probar login desde otra PC en la LAN.
5. Jobs: solo activar si el equipo autorizó (habilitar job **y** horario en SSMS).

## 12. Errores frecuentes

| Problema | Acción |
|----------|--------|
| ASADA ya existe al instalar | Usar `actualizar.ps1` |
| sqlcmd no encontrado | Instalar SSMS o `winget install sqlcmd` |
| Respaldos fallan | Ejecutar instalador como admin (icacls) |
| Express + jobs | Usar respaldos manuales / Developer |
| Demo no carga | Ya hay `SC-`; no re-ejecutar 19 |
| Frontend en blanco | Falta `npm run build` |

## 13. Limitaciones conocidas

- Instaladores legacy en raíz `Proyecto bases` no están en Git (duplicado manual hasta publicar).
- Cambios locales Fases 2A/3 deben estar en GitHub antes del clone del compañero.
- `00_crear_bases.sql` solo aplica rutas nuevas en instalación inicial; no mueve MDF existentes.
- Sin tabla de versión global: migraciones se detectan por objetos (`Tramo_Mora`, `nombre_base`).
- Empaquetar zip: `deploy\empaquetar.ps1`.

## 14. Pruebas estáticas del deploy

```powershell
.\Test-DeployScripts.ps1
```

No ejecuta SQL ni npm.
