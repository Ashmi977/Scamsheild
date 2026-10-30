<##
Sets up local MySQL history storage for ScamShield.

The MySQL client prompts for the root password itself. This script generates a
separate password for the restricted application account and stores it only in
the ignored config/scamshield.properties file.
##>

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$mysql = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
$configDirectory = Join-Path $projectRoot 'config'
$configFile = Join-Path $configDirectory 'scamshield.properties'

if (-not (Test-Path -LiteralPath $mysql)) {
    throw "MySQL client was not found at: $mysql"
}

$alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$randomBytes = New-Object byte[] 28
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($randomBytes)
} finally {
    $rng.Dispose()
}
$appPassword = -join ($randomBytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })

$sql = @"
CREATE DATABASE IF NOT EXISTS scamshield;
CREATE TABLE IF NOT EXISTS scamshield.analysis_history (
    analysis_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_source VARCHAR(20) NOT NULL,
    risk_score INT NOT NULL,
    risk_category VARCHAR(20) NOT NULL,
    scam_type VARCHAR(40) NULL,
    detected_indicators TEXT NOT NULL,
    analysis_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_risk_score CHECK (risk_score BETWEEN 0 AND 100),
    INDEX idx_analysis_timestamp (analysis_timestamp)
);
SET @ddl := (SELECT IF(COUNT(*) = 0,
    'ALTER TABLE scamshield.analysis_history ADD COLUMN scam_type VARCHAR(40) NULL AFTER risk_category',
    'SELECT 1') FROM information_schema.columns
    WHERE table_schema = 'scamshield' AND table_name = 'analysis_history' AND column_name = 'scam_type');
PREPARE migrate_stmt FROM @ddl;
EXECUTE migrate_stmt;
DEALLOCATE PREPARE migrate_stmt;
CREATE USER IF NOT EXISTS 'scamshield_user'@'localhost' IDENTIFIED BY '$appPassword';
ALTER USER 'scamshield_user'@'localhost' IDENTIFIED BY '$appPassword';
GRANT SELECT, INSERT, DELETE ON scamshield.analysis_history TO 'scamshield_user'@'localhost';
FLUSH PRIVILEGES;
"@

Write-Host 'Enter the MySQL root password when prompted.'
& $mysql '--protocol=TCP' '-h' 'localhost' '-P' '3306' '-u' 'root' '-p' '-e' $sql
if ($LASTEXITCODE -ne 0) {
    throw 'MySQL setup failed. No application configuration file was written.'
}

New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
$properties = @"
db.url=jdbc:mysql://localhost:3306/scamshield?useSSL=false&serverTimezone=UTC
db.user=scamshield_user
db.password=$appPassword
"@
[System.IO.File]::WriteAllText($configFile, $properties, [System.Text.UTF8Encoding]::new($false))

Write-Host 'ScamShield MySQL history is configured successfully.'
