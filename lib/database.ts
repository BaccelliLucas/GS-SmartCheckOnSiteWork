import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dataDirectory = join(process.cwd(), 'data')
const databasePath = join(dataDirectory, 'smart-check.db')

mkdirSync(dataDirectory, { recursive: true })

const globalDatabase = globalThis as typeof globalThis & { smartCheckDatabase?: DatabaseSync }

export const database = globalDatabase.smartCheckDatabase ?? new DatabaseSync(databasePath)

if (process.env.NODE_ENV !== 'production') globalDatabase.smartCheckDatabase = database

// Versão dos dados em memória: muda a cada importação ou alteração de configuração, invalidando caches
const dataVersionHolder = globalThis as typeof globalThis & { smartCheckDataVersion?: number }

export function dataVersion() {
  return dataVersionHolder.smartCheckDataVersion ?? 0
}

export function markDataChanged() {
  dataVersionHolder.smartCheckDataVersion = dataVersion() + 1
}

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -65536;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  -- Uma importação por fonte e mês de referência (AAAA-MM); reenviar o mesmo mês substitui a anterior
  CREATE TABLE IF NOT EXISTS source_imports (
    source TEXT NOT NULL CHECK (source IN ('lenel', 'it007', 'it2001', 'btravel', 'external', 'exceptions')),
    period TEXT NOT NULL,
    file_name TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source, period)
  );

  -- Foto mensal dos colaboradores (IT007)
  CREATE TABLE IF NOT EXISTS employee_snapshots (
    period TEXT NOT NULL,
    edv TEXT NOT NULL,
    full_name TEXT NOT NULL,
    subgroup TEXT,
    hr_area_name TEXT,
    division TEXT,
    position_name TEXT,
    flexible_schedule TEXT,
    predominant_home_office TEXT,
    disciplinary_manager TEXT,
    manager_name TEXT,
    manager_email TEXT,
    PRIMARY KEY (period, edv)
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS idx_employee_snapshots_edv_period ON employee_snapshots(edv, period);

  -- Ausências (IT2001) por mês de referência
  CREATE TABLE IF NOT EXISTS absence_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    edv TEXT NOT NULL,
    absence_type TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    days TEXT,
    calendar_days TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_absence_period ON absence_records(period, edv);

  -- Unidade organizacional de cada colaborador segundo o IT2001 do mês
  CREATE TABLE IF NOT EXISTS employee_units (
    period TEXT NOT NULL,
    edv TEXT NOT NULL,
    organizational_unit TEXT NOT NULL,
    PRIMARY KEY (period, edv)
  ) WITHOUT ROWID;

  -- Um registro por colaborador e dia com entrada (o Lenel traz várias passagens por dia)
  CREATE TABLE IF NOT EXISTS access_days (
    edv TEXT NOT NULL,
    access_date TEXT NOT NULL,
    PRIMARY KEY (edv, access_date)
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS idx_access_days_date ON access_days(access_date, edv);

  -- Arquivos guardados como vieram (bTravel e serviço externo), até as regras de cada um serem definidas
  CREATE TABLE IF NOT EXISTS raw_source_files (
    source TEXT NOT NULL,
    period TEXT NOT NULL,
    headers TEXT NOT NULL,
    rows TEXT NOT NULL,
    PRIMARY KEY (source, period)
  ) WITHOUT ROWID;

  -- Viagens das bases antigas do bTravel (TXT Matrícula;Data Embarque;Data Retorno): ficam guardadas de forma
  -- permanente, sem mês de referência, e nenhuma importação as apaga
  CREATE TABLE IF NOT EXISTS btravel_trips (
    edv TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    PRIMARY KEY (edv, start_date, end_date)
  ) WITHOUT ROWID;

  -- Serviço externo (EDV, Data, Local) por mês de referência: em dia útil conta como presença, como o bTravel
  CREATE TABLE IF NOT EXISTS external_services (
    period TEXT NOT NULL,
    edv TEXT NOT NULL,
    service_date TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (period, edv, service_date, location)
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS idx_external_services_date ON external_services(service_date, edv);

  -- EDVs que não aparecem no dashboard no mês de referência (lista de exceções)
  CREATE TABLE IF NOT EXISTS excluded_employees (
    period TEXT NOT NULL,
    edv TEXT NOT NULL,
    PRIMARY KEY (period, edv)
  ) WITHOUT ROWID;

  -- Exceções cadastradas no Management: colaboradores que batem com alguma regra não aparecem no dashboard (todos os meses)
  CREATE TABLE IF NOT EXISTS exclusion_rules (
    category TEXT NOT NULL CHECK (category IN ('edv', 'division', 'organizationalUnit', 'hrArea', 'subgroup', 'position', 'flexibleSchedule')),
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (category, value)
  );

  -- Categorias de exceção criadas no Management (ficam salvas mesmo sem itens)
  -- Acessos ao Smart Check por e-mail: general (Status e Tipo de contrato), detail (Presença no escritório e
  -- Colaboradores) e management, separados por vírgula
  CREATE TABLE IF NOT EXISTS access_grants (
    email TEXT PRIMARY KEY,
    levels TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS exclusion_categories (
    category TEXT PRIMARY KEY CHECK (category IN ('edv', 'division', 'organizationalUnit', 'hrArea', 'subgroup', 'position', 'flexibleSchedule')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS presence_targets (
    subgroup TEXT PRIMARY KEY,
    percentage REAL NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contract_presence_targets (
    contract_type TEXT PRIMARY KEY CHECK (contract_type IN ('Presencial', 'HO Preponderante', 'Home Office 100%')),
    minimum_days INTEGER NOT NULL CHECK (minimum_days >= 0 AND minimum_days <= 31),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS area_holidays (
    hr_area TEXT NOT NULL,
    holiday_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (hr_area, holiday_date)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
  );
`)

// Torna explícitas e configuráveis as regras por contrato que já fazem parte da política de presença
const contractTargetsSeedKey = 'contract_presence_targets_seeded_v1'
const contractTargetsSeeded = database.prepare('SELECT 1 FROM app_settings WHERE setting_key = ?').get(contractTargetsSeedKey)
if (!contractTargetsSeeded) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const insertContractTarget = database.prepare('INSERT OR IGNORE INTO contract_presence_targets (contract_type, minimum_days) VALUES (?, ?)')
    insertContractTarget.run('HO Preponderante', 1)
    insertContractTarget.run('Home Office 100%', 0)
    database.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)').run(contractTargetsSeedKey, 'true')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

// Bancos criados antes das fontes bTravel, serviço externo e exceções têm a restrição antiga em source_imports
const sourceImportsSql = (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'source_imports'").get() as { sql: string } | undefined)?.sql ?? ''
if (!sourceImportsSql.includes('exceptions')) {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE source_imports_new (
        source TEXT NOT NULL CHECK (source IN ('lenel', 'it007', 'it2001', 'btravel', 'external', 'exceptions')),
        period TEXT NOT NULL,
        file_name TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source, period)
      );
      INSERT INTO source_imports_new SELECT source, period, file_name, row_count, imported_at FROM source_imports;
      DROP TABLE source_imports;
      ALTER TABLE source_imports_new RENAME TO source_imports;
    `)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

// A categoria "Posição" exige ampliar as restrições CHECK dos bancos já existentes
const exclusionRulesSql = (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exclusion_rules'").get() as { sql: string } | undefined)?.sql ?? ''
const exclusionCategoriesSql = (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exclusion_categories'").get() as { sql: string } | undefined)?.sql ?? ''
if (!exclusionRulesSql.includes("'flexibleSchedule'") || !exclusionCategoriesSql.includes("'flexibleSchedule'")) {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE exclusion_rules_new (
        category TEXT NOT NULL CHECK (category IN ('edv', 'division', 'organizationalUnit', 'hrArea', 'subgroup', 'position', 'flexibleSchedule')),
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (category, value)
      );
      INSERT INTO exclusion_rules_new SELECT category, value, created_at FROM exclusion_rules;

      CREATE TABLE exclusion_categories_new (
        category TEXT PRIMARY KEY CHECK (category IN ('edv', 'division', 'organizationalUnit', 'hrArea', 'subgroup', 'position', 'flexibleSchedule')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO exclusion_categories_new SELECT category, created_at FROM exclusion_categories;

      DROP TABLE exclusion_rules;
      ALTER TABLE exclusion_rules_new RENAME TO exclusion_rules;
      DROP TABLE exclusion_categories;
      ALTER TABLE exclusion_categories_new RENAME TO exclusion_categories;
    `)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

const defaultHolidayAreas = ['Campinas', 'Campinas ADM']
const holidaySeedKey = 'holidays_seeded_2026'
const holidaySeeded = database.prepare('SELECT 1 FROM app_settings WHERE setting_key = ?').get(holidaySeedKey)
if (!holidaySeeded) {
  const seededHolidays = [
    '2026-02-16', '2026-02-17',
    '2026-04-03', '2026-04-20', '2026-04-21',
    '2026-05-01',
    '2026-06-04', '2026-06-05',
    '2026-07-17',
    '2026-09-07',
    '2026-10-12',
    '2026-11-02', '2026-11-20',
    '2026-12-25',
  ]
  const insertHoliday = database.prepare('INSERT OR IGNORE INTO area_holidays (hr_area, holiday_date) VALUES (?, ?)')
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const area of defaultHolidayAreas) for (const holiday of seededHolidays) insertHoliday.run(area, holiday)
    database.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)').run(holidaySeedKey, 'true')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

const legacyHolidaysTable = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'holidays'").get()
if (legacyHolidaysTable) {
  const insertHoliday = database.prepare('INSERT OR IGNORE INTO area_holidays (hr_area, holiday_date) SELECT ?, holiday_date FROM holidays')
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const area of defaultHolidayAreas) insertHoliday.run(area)
    database.exec('DROP TABLE holidays')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

const legacyAccessTable = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'access_records'").get()
if (legacyAccessTable) {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec('INSERT OR IGNORE INTO access_days (edv, access_date) SELECT DISTINCT edv, access_date FROM access_records')
    database.exec('DROP TABLE access_records')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  database.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);')
}

// Lista mensal de exceções passou a guardar nome, HRBP solicitante e cargo/justificativa da planilha
const excludedColumns = new Set((database.prepare('PRAGMA table_info(excluded_employees)').all() as unknown as { name: string }[]).map(column => column.name))
if (!excludedColumns.has('full_name')) database.exec('ALTER TABLE excluded_employees ADD COLUMN full_name TEXT')
if (!excludedColumns.has('hrbp')) database.exec('ALTER TABLE excluded_employees ADD COLUMN hrbp TEXT')
if (!excludedColumns.has('justification')) database.exec('ALTER TABLE excluded_employees ADD COLUMN justification TEXT')

const snapshotColumns = new Set((database.prepare('PRAGMA table_info(employee_snapshots)').all() as unknown as { name: string }[]).map(column => column.name))
if (!snapshotColumns.has('position_name')) database.exec('ALTER TABLE employee_snapshots ADD COLUMN position_name TEXT')
if (!snapshotColumns.has('flexible_schedule')) database.exec('ALTER TABLE employee_snapshots ADD COLUMN flexible_schedule TEXT')
if (!snapshotColumns.has('manager_name')) database.exec('ALTER TABLE employee_snapshots ADD COLUMN manager_name TEXT')
if (!snapshotColumns.has('manager_email')) database.exec('ALTER TABLE employee_snapshots ADD COLUMN manager_email TEXT')

// Migra a importação única antiga (tabelas imports, employees e it2001_records) para o modelo mensal
const legacyImportsTable = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'imports'").get()
if (legacyImportsTable) {
  const legacyImport = database.prepare('SELECT * FROM imports WHERE reference_year IS NOT NULL AND reference_month IS NOT NULL ORDER BY id DESC LIMIT 1').get() as {
    imported_at: string; lenel_file_name: string; it007_file_name: string; it2001_file_name: string
    lenel_rows: number; it007_rows: number; it2001_rows: number; reference_year: number; reference_month: number
  } | undefined
  const tableExists = (name: string) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
  const legacyEmployeesHavePosition = tableExists('employees') && (database.prepare('PRAGMA table_info(employees)').all() as unknown as { name: string }[]).some(column => column.name === 'position')
  const legacyEmployeesHaveFlexibleSchedule = tableExists('employees') && (database.prepare('PRAGMA table_info(employees)').all() as unknown as { name: string }[]).some(column => column.name === 'flexible_schedule')
  database.exec('BEGIN IMMEDIATE')
  try {
    if (legacyImport) {
      const period = `${legacyImport.reference_year}-${String(legacyImport.reference_month).padStart(2, '0')}`
      const insertSource = database.prepare('INSERT OR REPLACE INTO source_imports (source, period, file_name, row_count, imported_at) VALUES (?, ?, ?, ?, ?)')
      insertSource.run('lenel', period, legacyImport.lenel_file_name, legacyImport.lenel_rows, legacyImport.imported_at)
      insertSource.run('it007', period, legacyImport.it007_file_name, legacyImport.it007_rows, legacyImport.imported_at)
      insertSource.run('it2001', period, legacyImport.it2001_file_name, legacyImport.it2001_rows, legacyImport.imported_at)
      if (tableExists('employees')) {
        if (legacyEmployeesHavePosition && legacyEmployeesHaveFlexibleSchedule) {
          database.prepare(`INSERT OR REPLACE INTO employee_snapshots (period, edv, full_name, subgroup, hr_area_name, division, position_name, flexible_schedule, predominant_home_office, disciplinary_manager)
            SELECT ?, edv, full_name, subgroup, hr_area_name, division, position, flexible_schedule, predominant_home_office, disciplinary_manager FROM employees`).run(period)
        } else if (legacyEmployeesHavePosition) {
          database.prepare(`INSERT OR REPLACE INTO employee_snapshots (period, edv, full_name, subgroup, hr_area_name, division, position_name, predominant_home_office, disciplinary_manager)
            SELECT ?, edv, full_name, subgroup, hr_area_name, division, position, predominant_home_office, disciplinary_manager FROM employees`).run(period)
        } else if (legacyEmployeesHaveFlexibleSchedule) {
          database.prepare(`INSERT OR REPLACE INTO employee_snapshots (period, edv, full_name, subgroup, hr_area_name, division, flexible_schedule, predominant_home_office, disciplinary_manager)
            SELECT ?, edv, full_name, subgroup, hr_area_name, division, flexible_schedule, predominant_home_office, disciplinary_manager FROM employees`).run(period)
        } else {
          database.prepare(`INSERT OR REPLACE INTO employee_snapshots (period, edv, full_name, subgroup, hr_area_name, division, predominant_home_office, disciplinary_manager)
            SELECT ?, edv, full_name, subgroup, hr_area_name, division, predominant_home_office, disciplinary_manager FROM employees`).run(period)
        }
      }
      if (tableExists('it2001_records')) {
        database.prepare(`INSERT INTO absence_records (period, edv, absence_type, start_date, end_date, days, calendar_days)
          SELECT ?, edv, absence_type, start_date, end_date, days, calendar_days FROM it2001_records WHERE trim(absence_type) <> ''`).run(period)
        database.prepare(`INSERT OR REPLACE INTO employee_units (period, edv, organizational_unit)
          SELECT ?, edv, organizational_unit FROM it2001_records WHERE trim(organizational_unit) <> '' ORDER BY id`).run(period)
      }
    }
    database.exec('DROP TABLE IF EXISTS it2001_records; DROP TABLE IF EXISTS employees; DROP TABLE imports;')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  database.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);')
}

const targetResetKey ='presence_targets_reset_2026_v1'
const targetsReset = database.prepare('SELECT 1 FROM app_settings WHERE setting_key = ?').get(targetResetKey)
if (!targetsReset) {
  const elevatedSubgroups = ['CH', 'G1', 'V1', 'G2', 'V2', 'G3', 'V3', 'G4', 'V4']
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec('UPDATE presence_targets SET percentage = 60, updated_at = CURRENT_TIMESTAMP')
    const upsertTarget = database.prepare('INSERT INTO presence_targets (subgroup, percentage) VALUES (?, 80) ON CONFLICT(subgroup) DO UPDATE SET percentage = 80, updated_at = CURRENT_TIMESTAMP')
    for (const subgroup of elevatedSubgroups) upsertTarget.run(subgroup)
    database.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)').run(targetResetKey, 'true')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export const smartCheckDatabasePath = databasePath
