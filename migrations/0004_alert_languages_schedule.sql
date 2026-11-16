-- Alerts in several languages (shown to each pilgrim in their kiosk language) and scheduled alerts.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ghat_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT '{kiosk,staff}';
