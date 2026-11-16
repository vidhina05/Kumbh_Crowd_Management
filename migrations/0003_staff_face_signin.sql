-- Staff IDs (printed on the control-room card) and opt-in face sign-in for staff.
CREATE SEQUENCE IF NOT EXISTS staff_code_seq START 1186;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS staff_code text;
ALTER TABLE admin_users ALTER COLUMN staff_code SET DEFAULT ('KMB-ADM-' || nextval('staff_code_seq')::text);
UPDATE admin_users SET staff_code = 'KMB-ADM-' || nextval('staff_code_seq')::text WHERE staff_code IS NULL;
ALTER TABLE admin_users ALTER COLUMN staff_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_staff_code_key ON admin_users (staff_code);
-- A face template (1024 numbers, encrypted) made on the staff member's own console when they opt in. Never a photo.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS face_template_enc text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS face_enrolled_at timestamptz;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS face_failed integer NOT NULL DEFAULT 0;
