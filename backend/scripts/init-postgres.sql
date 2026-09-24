-- Initialize database for AIVHub Core (Cal.com runs cloud-hosted via API)
SELECT 'CREATE DATABASE aivhub' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aivhub')\gexec

\c aivhub;
CREATE EXTENSION IF NOT EXISTS vector;

