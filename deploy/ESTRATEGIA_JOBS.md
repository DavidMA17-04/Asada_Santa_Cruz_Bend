# Actualización segura de jobs SQL Server Agent

## Problema

`17_jobs_sql_agent.sql` llama a `sp_delete_job` antes de crear cada job. Eso **elimina el job y su historial** en msdb. El modo **Actualizar** del instalador **no** ejecuta este script completo.

## Cuándo los jobs están “desactualizados”

Tras la migración de respaldos multibase, los pasos T-SQL deben filtrar `p.nombre_base = 'ASADA'` en los tres jobs de respaldo operativos. Si los jobs se instalaron antes de publicar ese cambio, el comando puede seleccionar la política incorrecta cuando exista política ASADA_DW.

`Install-AsadaAgentJobs.ps1 -Modo Actualizar` **informa** si el paso instalado no contiene `nombre_base`; **no** modifica msdb.

## Estrategia recomendada (requiere autorización explícita)

1. Documentar horarios y estado `enabled` actual de cada `Job_*`.
2. En SSMS, por cada job de respaldo ASADA, editar el paso T-SQL copiando el comando desde el `17_jobs_sql_agent.sql` del repositorio publicado (con filtro `nombre_base`).
3. **No** habilitar jobs hasta prueba manual.
4. Alternativa destructiva (solo instalación nueva o con respaldo de msdb): `instalar.ps1 -InstalarJobs -RecrearJobs` — **borra y recrea** los cinco jobs del script 17.

## Job faltante ASADA_DW

Si solo falta `Job_RespaldoCompletoDW`:

```powershell
.\actualizar.ps1 -ConfirmarMigracion -ConfirmarRespaldoComprobable -InstalarJobsFaltantes
```

(o ejecutar `sql/sql/17_job_respaldo_completo_dw.sql` en msdb). Ese script solo afecta al job DW.

## Verificación

```powershell
.\verificar.ps1
```

Comprobar en SSMS: seis jobs, `enabled = 0`, horarios deshabilitados.
