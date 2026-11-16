/**
 * Roles and permissions. The SERVER enforces these on every admin API call;
 * the UI only uses them to hide what a role cannot do.
 */
export const ROLES = ["super_admin", "operations", "crowd_control", "help_desk", "medical"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super admin",
  operations: "Operations",
  crowd_control: "Crowd control",
  help_desk: "Help desk · lost & found",
  medical: "Medical",
};

export const PERMISSIONS = {
  "overview.view": ["super_admin", "operations", "crowd_control", "help_desk", "medical"],
  "families.view": ["super_admin", "operations", "help_desk"],
  "families.update": ["super_admin", "operations"],
  "help.view": ["super_admin", "operations", "crowd_control", "help_desk", "medical"],
  "help.update": ["super_admin", "operations", "help_desk", "medical"],
  "lost.view": ["super_admin", "operations", "help_desk"],
  "lost.update": ["super_admin", "operations", "help_desk"],
  "alerts.view": ["super_admin", "operations", "crowd_control", "help_desk", "medical"],
  "alerts.manage": ["super_admin", "operations", "crowd_control"],
  "ghats.update": ["super_admin", "operations", "crowd_control"],
  "kiosks.view": ["super_admin", "operations"],
  "kiosks.manage": ["super_admin"],
  "reports.view": ["super_admin", "operations"],
  "users.manage": ["super_admin"],
  "audit.view": ["super_admin"],
  "assistant.use": ["super_admin", "operations", "crowd_control"],
  "batches.view": ["super_admin", "operations", "crowd_control"],
  "diversions.create": ["super_admin", "operations", "crowd_control"],
  "diversions.approve": ["super_admin", "operations", "crowd_control"],
  "gates.manage": ["super_admin", "operations", "crowd_control"],
  "sensors.view": ["super_admin", "operations", "crowd_control"],
  "sensors.manage": ["super_admin"],
  "faces.search": ["super_admin", "operations", "help_desk"],
  "shifts.use": ["super_admin", "operations", "crowd_control", "help_desk", "medical"],
  "map.view": ["super_admin", "operations", "crowd_control", "help_desk", "medical"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | string | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

/** Medical staff may only work on medical help requests. */
export function canUpdateHelpType(role: Role, type: string): boolean {
  if (!can(role, "help.update")) return false;
  if (role === "medical") return type === "medical";
  return true;
}
