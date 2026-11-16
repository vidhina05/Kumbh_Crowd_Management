import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, date, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Data model. Keep in sync with migrations/*.sql (the migrations are the source of truth for the database).
 * Personal data columns end in `Enc` (AES-256-GCM) or `Hash` (keyed HMAC) — never plain.
 */

export const ghats = pgTable("ghats", {
  id: text("id").primaryKey(), // e.g. "ram-ghat"
  name: text("name").notNull(),
  nameHi: text("name_hi").notNull(),
  gate: text("gate").notNull(),
  capacity: integer("capacity").notNull(),
  occupancy: integer("occupancy").notNull().default(0),
  // Where the occupancy number comes from. 'manual' = typed in by staff; 'sensor' = an integration.
  occupancySource: text("occupancy_source").notNull().default("manual"),
  occupancyUpdatedAt: timestamp("occupancy_updated_at", { withTimezone: true }),
  occupancyUpdatedBy: uuid("occupancy_updated_by"),
  walkNote: text("walk_note").notNull().default(""),
  meetingPoint: text("meeting_point").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  mapX: real("map_x").notNull().default(50),
  mapY: real("map_y").notNull().default(50),
  safeLimitPct: integer("safe_limit_pct").notNull().default(80),
});

export const slots = pgTable(
  "slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ghatId: text("ghat_id").notNull().references(() => ghats.id),
    day: date("day").notNull(),
    startTime: text("start_time").notNull(), // "06:15"
    endTime: text("end_time").notNull(),
    batchNo: integer("batch_no").notNull(),
    capacity: integer("capacity").notNull(),
    booked: integer("booked").notNull().default(0),
  },
  (t) => [uniqueIndex("slots_unique").on(t.ghatId, t.day, t.startTime), index("slots_day").on(t.day)],
);

export const kiosks = pgTable("kiosks", {
  id: text("id").primaryKey(), // "K-17"
  name: text("name").notNull(),
  location: text("location").notNull(),
  tokenHash: text("token_hash").notNull(),
  active: boolean("active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastSeenVersion: text("last_seen_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  mapX: real("map_x"),
  mapY: real("map_y"),
});

export const families = pgTable(
  "families",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passCode: text("pass_code").notNull().unique(),
    leaderName: text("leader_name").notNull(),
    phoneEnc: text("phone_enc").notNull(),
    phoneHash: text("phone_hash").notNull(),
    phoneLast4: text("phone_last4").notNull(),
    homeTown: text("home_town").notNull().default(""),
    language: text("language").notNull(),
    meetingPoint: text("meeting_point").notNull().default(""),
    slotId: uuid("slot_id").notNull().references(() => slots.id),
    kioskId: text("kiosk_id").references(() => kiosks.id),
    consentVersion: text("consent_version").notNull(),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    photoConsent: boolean("photo_consent").notNull().default(false),
    slotChangesLeft: integer("slot_changes_left").notNull().default(1),
    status: text("status").notNull().default("registered"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
    idMethod: text("id_method").notNull().default("phone"),
    phoneVerified: boolean("phone_verified").notNull().default(true),
    aadhaarRefHash: text("aadhaar_ref_hash"),
    aadhaarLast4: text("aadhaar_last4"),
    faceConsent: boolean("face_consent").notNull().default(false),
  },
  (t) => [index("families_phone_hash").on(t.phoneHash), index("families_created").on(t.createdAt)],
);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    age: integer("age").notNull(),
    relation: text("relation").notNull(),
    needs: jsonb("needs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    isLeader: boolean("is_leader").notNull().default(false),
    bandId: text("band_id"),
    photoEnc: text("photo_enc"),
    faceTemplateEnc: text("face_template_enc"),
    gender: text("gender"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("members_family").on(t.familyId)],
);

export const otpChallenges = pgTable("otp_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  phoneHash: text("phone_hash").notNull(),
  phoneEnc: text("phone_enc").notNull(),
  codeHash: text("code_hash").notNull(),
  kioskId: text("kiosk_id"),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaLastStep: bigint("mfa_last_step", { mode: "number" }).notNull().default(0),
  phoneEnc: text("phone_enc"),
  staffCode: text("staff_code").notNull().default(sql`('KMB-ADM-' || nextval('staff_code_seq')::text)`),
  faceTemplateEnc: text("face_template_enc"),
  faceEnrolledAt: timestamp("face_enrolled_at", { withTimezone: true }),
  faceFailed: integer("face_failed").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const helpRequests = pgTable(
  "help_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    clientRequestId: text("client_request_id").unique(),
    type: text("type").notNull(),
    description: text("description").notNull().default(""),
    location: text("location").notNull().default(""),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    kioskId: text("kiosk_id").references(() => kiosks.id),
    familyId: uuid("family_id").references(() => families.id, { onDelete: "set null" }),
    assignedTo: uuid("assigned_to").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("help_status").on(t.status, t.createdAt)],
);

export const lostCases = pgTable(
  "lost_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    clientRequestId: text("client_request_id").unique(),
    personName: text("person_name").notNull(),
    age: integer("age"),
    description: text("description").notNull().default(""),
    lastSeen: text("last_seen").notNull().default(""),
    reporterName: text("reporter_name").notNull().default(""),
    reporterPhoneEnc: text("reporter_phone_enc"),
    reporterPhoneLast4: text("reporter_phone_last4"),
    status: text("status").notNull().default("open"),
    kioskId: text("kiosk_id").references(() => kiosks.id),
    familyId: uuid("family_id").references(() => families.id, { onDelete: "set null" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    assignedTo: uuid("assigned_to").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    foundPhotoEnc: text("found_photo_enc"),
    foundAt: timestamp("found_at", { withTimezone: true }),
    foundLocation: text("found_location").notNull().default(""),
    reunitedAt: timestamp("reunited_at", { withTimezone: true }),
    thanksSentAt: timestamp("thanks_sent_at", { withTimezone: true }),
  },
  (t) => [index("lost_status").on(t.status, t.createdAt)],
);

export const caseNotes = pgTable(
  "case_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseType: text("case_type").notNull(), // 'help' | 'lost'
    caseId: uuid("case_id").notNull(),
    authorId: uuid("author_id").references(() => adminUsers.id, { onDelete: "set null" }),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notes_case").on(t.caseType, t.caseId)],
);

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  severity: text("severity").notNull(), // info | warning | critical
  title: text("title").notNull(),
  message: text("message").notNull(),
  ghatId: text("ghat_id").references(() => ghats.id),
  audience: text("audience").notNull().default("staff"), // staff | kiosk | both
  status: text("status").notNull().default("active"),
  createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedBy: uuid("resolved_by").references(() => adminUsers.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorType: text("actor_type").notNull(), // admin | kiosk | system
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("audit_at").on(t.at)],
);

export const gates = pgTable("gates", {
  id: text("id").primaryKey(),
  ghatId: text("ghat_id").notNull().references(() => ghats.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("both"),
  status: text("status").notNull().default("open"),
  mapX: real("map_x").notNull().default(50),
  mapY: real("map_y").notNull().default(50),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  statusChangedBy: uuid("status_changed_by"),
});

export const sensors = pgTable("sensors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // gate_counter | zone_counter | camera_counter
  ghatId: text("ghat_id").notNull().references(() => ghats.id, { onDelete: "cascade" }),
  gateId: text("gate_id").references(() => gates.id, { onDelete: "set null" }),
  keyHash: text("key_hash").notNull(),
  active: boolean("active").notNull().default(true),
  isSimulated: boolean("is_simulated").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastReading: jsonb("last_reading").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sensorReadings = pgTable(
  "sensor_readings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sensorId: text("sensor_id").notNull().references(() => sensors.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
    peopleIn: integer("people_in"),
    peopleOut: integer("people_out"),
    occupancy: integer("occupancy"),
    source: text("source").notNull(),
  },
  (t) => [index("sensor_readings_sensor_at").on(t.sensorId, t.at)],
);

export const crowdHistory = pgTable(
  "crowd_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ghatId: text("ghat_id").notNull().references(() => ghats.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    occupancy: integer("occupancy").notNull(),
    inflowPerMin: real("inflow_per_min"),
    outflowPerMin: real("outflow_per_min"),
    source: text("source").notNull(),
  },
  (t) => [index("crowd_history_ghat_at").on(t.ghatId, t.at)],
);

export const diversions = pgTable("diversions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  fromGhatId: text("from_ghat_id").notNull().references(() => ghats.id),
  toGhatId: text("to_ghat_id").notNull().references(() => ghats.id),
  day: date("day").notNull(),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("awaiting_approval"),
  familiesCount: integer("families_count").notNull().default(0),
  peopleCount: integer("people_count").notNull().default(0),
  projection: jsonb("projection").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
  approvedBy: uuid("approved_by").references(() => adminUsers.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  undoneBy: uuid("undone_by").references(() => adminUsers.id, { onDelete: "set null" }),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const diversionMoves = pgTable(
  "diversion_moves",
  {
    diversionId: uuid("diversion_id").notNull().references(() => diversions.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
    fromSlotId: uuid("from_slot_id").notNull().references(() => slots.id),
    toSlotId: uuid("to_slot_id").notNull().references(() => slots.id),
    people: integer("people").notNull(),
    smsStatus: text("sms_status").notNull().default("not_sent"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.diversionId, t.familyId] })],
);

export const diversionEvents = pgTable("diversion_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  diversionId: uuid("diversion_id").notNull().references(() => diversions.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  actorId: uuid("actor_id").references(() => adminUsers.id, { onDelete: "set null" }),
});

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  controlRoom: text("control_room").notNull().default("Sangam Control"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  handoverTo: uuid("handover_to").references(() => adminUsers.id, { onDelete: "set null" }),
  handoverNotes: text("handover_notes").notNull().default(""),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
});

export const faceMatches = pgTable("face_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  lostCaseId: uuid("lost_case_id").notNull().references(() => lostCases.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  score: real("score").notNull(),
  status: text("status").notNull().default("suggested"),
  reviewedBy: uuid("reviewed_by").references(() => adminUsers.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
