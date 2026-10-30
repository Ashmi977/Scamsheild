-- ScamShield history schema (v2). Raw message text is never stored.
CREATE DATABASE IF NOT EXISTS scamshield;
USE scamshield;

CREATE TABLE IF NOT EXISTS analysis_history (
    analysis_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_source VARCHAR(20) NOT NULL,          -- SMS, WHATSAPP, UPI, EMAIL
    risk_score INT NOT NULL,
    risk_category VARCHAR(20) NOT NULL,           -- LOW, MEDIUM, HIGH, CRITICAL
    scam_type VARCHAR(40) NULL,                   -- likely pattern, e.g. KYC_PHISHING
    detected_indicators TEXT NOT NULL,            -- indicator titles only, no evidence text
    analysis_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_risk_score CHECK (risk_score BETWEEN 0 AND 100),
    INDEX idx_analysis_timestamp (analysis_timestamp)
);
