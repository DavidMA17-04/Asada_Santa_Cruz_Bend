# Instalación rápida (ASADA Santa Cruz)

Guía resumida. Procedimiento completo: [DESPLIEGUE.md](DESPLIEGUE.md).

## Requisitos

- Windows 10/11
- SQL Server 2019+ (**Developer** recomendado si usarán jobs de Agent)
- SSMS o `sqlcmd`, ODBC Driver 17/18
- Node.js 20+

## Estructura de carpetas

Los **tres repositorios** deben quedar como carpetas hermanas con estos nombres exactos:

```
CarpetaDelProyecto/
  backend/    ← repo Asada_Santa_Cruz_Bend (contiene deploy/)
  frontend/   ← repo Asada_Santa_Cruz_Fend
  sql/        ← repo Proyecto_Admin_DB_Scripts (scripts en sql/sql/)
```

## Instalación nueva

1. Clonar los tres repos en `development` (ver DESPLIEGUE.md).
2. Abrir PowerShell en `backend\deploy`.
3. Ejecutar:

   ```powershell
   .\instalar.ps1 -Servidor "localhost"
   ```

   Opciones útiles:

   - `-CargarDemo` — ejecuta `19_datos_demo.sql` (una sola vez; medidores `SC-`).
   - `-InstalarJobs` — crea los 6 jobs **deshabilitados** (no Express).
   - `-RecrearJobs` — solo con `-InstalarJobs` si debe recrear jobs existentes.
   - `-RutaDatos`, `-RutaLog`, `-RutaRespaldosASADA`, `-RutaRespaldosASADA_DW` — rutas alternativas.
   - `-WhatIf` — muestra plan sin ejecutar.

4. Verificar: `.\verificar.ps1`
5. Iniciar: `INICIAR.bat` → http://localhost:3000/

Usuarios iniciales (cambiar en producción): `admin`, `dba` (contraseñas en README del backend).

## Actualización (base ya existente)

**No** use `instalar.ps1` si ASADA ya existe. Use:

```powershell
.\actualizar.ps1 -Servidor "localhost"
```

Para aplicar migraciones necesita **ambos** switches y un respaldo previo:

```powershell
.\actualizar.ps1 -ConfirmarMigracion -ConfirmarRespaldoComprobable -InstalarJobsFaltantes
```

## Notas

- No se modifica ni inicia SQL Server Agent automáticamente.
- Los jobs nacen deshabilitados (`17_jobs_sql_agent.sql`).
- Los instaladores en la raíz antigua de `Proyecto bases` (fuera de Git) siguen válidos; la versión oficial está en `backend/deploy/`.
