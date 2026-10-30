-- Upgrades a v1 ScamShield database (created before scam_type existed). Safe to run more than once.
-- The application also works without this column; it just cannot store the likely scam pattern.
SET @ddl := (
    SELECT IF(COUNT(*) = 0,
              'ALTER TABLE scamshield.analysis_history ADD COLUMN scam_type VARCHAR(40) NULL AFTER risk_category',
              'SELECT ''scam_type column already present''')
    FROM information_schema.columns
    WHERE table_schema = 'scamshield' AND table_name = 'analysis_history' AND column_name = 'scam_type');
PREPARE migrate_stmt FROM @ddl;
EXECUTE migrate_stmt;
DEALLOCATE PREPARE migrate_stmt;
