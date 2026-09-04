-- Initialize databases for AIVHub Core & Cal.com Self-Hosted
SELECT 'CREATE DATABASE aivhub' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aivhub')\gexec
SELECT 'CREATE DATABASE calcom' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'calcom')\gexec
