-- Initial schema. Personal data is stored encrypted (*_enc) or as keyed hashes (*_hash).
CREATE TABLE ghats (
  id text PRIMARY KEY,
  name text NOT NULL,
  name_hi text NOT NULL,
  gate text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  occupancy integer NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
  occupancy_source text NOT NULL DEFAULT 'manual' CHECK (occupancy_source IN ('manual', 'sensor')),
  occupancy_updated_at timestamptz,
  occupancy_updated_by uuid,
  walk_note text NOT NULL DEFAULT '',
  meeting_point text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ghat_id text NOT NULL REFERENCES ghats(id),
  day date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  batch_no integer NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  booked integer NOT NULL DEFAULT 0,
  CONSTRAINT slots_booked_within_capacity CHECK (booked >= 0 AND booked <= capacity)
);
CREATE UNIQUE INDEX slots_unique ON slots (ghat_id, day, start_time);
CREATE INDEX slots_day ON slots (day);

CREATE TABLE kiosks (
  id text PRIMARY KEY,
  name text NOT NULL,
  location text NOT NULL,
  token_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  last_seen_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'operations', 'crowd_control', 'help_desk', 'medical')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_code text NOT NULL UNIQUE,
  leader_name text NOT NULL,
  phone_enc text NOT NULL,
  phone_hash text NOT NULL,
  phone_last4 text NOT NULL,
  home_town text NOT NULL DEFAULT '',
  language text NOT NULL,
  meeting_point text NOT NULL DEFAULT '',
  slot_id uuid NOT NULL REFERENCES slots(id),
  kiosk_id text REFERENCES kiosks(id),
  consent_version text NOT NULL,
  consent_at timestamptz NOT NULL,
  photo_consent boolean NOT NULL DEFAULT false,
  slot_changes_left integer NOT NULL DEFAULT 1 CHECK (slot_changes_left >= 0),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'on_the_way', 'bathing', 'left')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL
);
CREATE INDEX families_phone_hash ON families (phone_hash);
CREATE INDEX families_created ON families (created_at);
CREATE INDEX families_delete_after ON families (delete_after);

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name text NOT NULL,
  age integer NOT NULL CHECK (age >= 0 AND age <= 120),
  relation text NOT NULL,
  needs jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_leader boolean NOT NULL DEFAULT false,
  band_id text UNIQUE,
  photo_enc text,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX members_family ON members (family_id);

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash text NOT NULL,
  phone_enc text NOT NULL,
  code_hash text NOT NULL,
  kiosk_id text,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone ON otp_challenges (phone_hash, created_at);

CREATE TABLE help_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  client_request_id text UNIQUE,
  type text NOT NULL CHECK (type IN ('medical', 'lost_person', 'wheelchair', 'language', 'other')),
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'cancelled')),
  kiosk_id text REFERENCES kiosks(id),
  family_id uuid REFERENCES families(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX help_status ON help_requests (status, created_at);

CREATE TABLE lost_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  client_request_id text UNIQUE,
  person_name text NOT NULL,
  age integer CHECK (age IS NULL OR (age >= 0 AND age <= 120)),
  description text NOT NULL DEFAULT '',
  last_seen text NOT NULL DEFAULT '',
  reporter_name text NOT NULL DEFAULT '',
  reporter_phone_enc text,
  reporter_phone_last4 text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'searching', 'found', 'reunited', 'closed')),
  kiosk_id text REFERENCES kiosks(id),
  family_id uuid REFERENCES families(id) ON DELETE SET NULL,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX lost_status ON lost_cases (status, created_at);

CREATE TABLE case_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type text NOT NULL CHECK (case_type IN ('help', 'lost')),
  case_id uuid NOT NULL,
  author_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_case ON case_notes (case_type, case_id);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title text NOT NULL,
  message text NOT NULL,
  ghat_id text REFERENCES ghats(id),
  audience text NOT NULL DEFAULT 'staff' CHECK (audience IN ('staff', 'kiosk', 'both')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  created_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  resolved_at timestamptz
);

CREATE TABLE audit_log (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('admin', 'kiosk', 'system')),
  actor_id text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_at ON audit_log (at);
