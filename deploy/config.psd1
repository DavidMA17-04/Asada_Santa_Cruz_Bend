@{
    # Valores por defecto de rutas (instalación nueva). Sobrescribir con parámetros de instalar.ps1.
    RutaDatos              = 'c:\sqldata'
    RutaLog                = 'c:\sqllog'
    RutaRespaldosASADA     = 'C:\Respaldos\ASADA\'
    RutaRespaldosASADA_DW  = 'C:\Respaldos\ASADA_DW\'

    # Nombres de jobs del proyecto (no tocar jobs ajenos).
    JobsProyecto = @(
        'Job_RespaldoCompleto'
        'Job_RespaldoDiferencial'
        'Job_RespaldoLogTransacciones'
        'Job_CargaNocturnaDW'
        'Job_MantenimientoNocturno'
        'Job_RespaldoCompletoDW'
    )

    # Scripts SQL relativos a sql/sql/
    ScriptEjecutarTodo     = 'ejecutar_todo.sql'
    ScriptDemo             = '19_datos_demo.sql'
    ScriptJobs             = '17_jobs_sql_agent.sql'
    ScriptJobSoloDw        = '17_job_respaldo_completo_dw.sql'
    ScriptVerificar        = 'verificar_instalacion.sql'

    Migraciones = @(
        @{
            Id          = 'development_main'
            Script      = 'actualizar_a_development.sql'
            Descripcion = 'Morosidad por tramos, incidencias DW, acceso DW'
            Prueba      = 'Tramo_Mora'
            Base        = 'ASADA'
        }
        @{
            Id          = 'respaldos_multibase'
            Script      = '22_migracion_respaldos_dw.sql'
            Descripcion = 'Políticas ASADA_DW y procedimientos multibase'
            Prueba      = 'nombre_base'
            Tabla       = 'Politica_Respaldo'
            Base        = 'ASADA'
        }
    )
}
