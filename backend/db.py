import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','manual_comped')),
    payment_method TEXT CHECK (payment_method IN ('pix','sumup_card')),
    approved_at TIMESTAMPTZ,
    approved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transformation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued','processing','completed','failed','deleted')),
    source_object_key TEXT,
    target_object_key TEXT,
    result_object_key TEXT,
    engine_name TEXT,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    job_id UUID REFERENCES transformation_jobs(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by TEXT;
CREATE TABLE IF NOT EXISTS payment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('pix','sumup_card')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
    proof_reference TEXT,
    provider_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_requests_user_created ON payment_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_approval_payment ON users(approval_status, payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON transformation_jobs(user_id, created_at DESC);
DROP TABLE IF EXISTS credit_ledger;
DROP TABLE IF EXISTS credit_accounts;
"""

@contextmanager
def get_connection():
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL não configurada.")
    with psycopg.connect(url, row_factory=dict_row, connect_timeout=10) as conn:
        yield conn


def initialize_database():
    with get_connection() as conn:
        for statement in SCHEMA.split(";"):
            if statement.strip():
                conn.execute(statement)


def db_ready() -> bool:
    if not os.getenv("DATABASE_URL", "").strip():
        return False
    try:
        with get_connection() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False
