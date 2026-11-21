// Single source of truth for authorization. Used by the bot now, and by the
// backend/dashboard API later. Pure functions, no I/O.

export const SPECIAL_ROLE_KINDS = ['admin', 'mod', 'antinuke'] as const;
export type SpecialRoleKind = (typeof SPECIAL_ROLE_KINDS)[number];

export interface ModuleDef {
  id: string;
  description: string;
  /** Only the permanent bot owner (OWNER_ID) may use it. Cannot be granted. */
  ownerOnly?: boolean;
}

export const MODULES: ModuleDef[] = [
  { id: 'prefix', description: 'Change the command prefix' },
  { id: 'roles', description: 'Configure special roles', ownerOnly: true },
  { id: 'permissions', description: 'Edit role permissions', ownerOnly: true },
  { id: 'trustedbots', description: 'Manage the trusted bot list', ownerOnly: true },
  { id: 'trustedusers', description: 'Manage the trusted user list', ownerOnly: true },
  { id: 'antinuke', description: 'Anti-Nuke configuration' },
  { id: 'honeypot', description: 'Honeypot configuration' },
  { id: 'moderation', description: 'Moderation actions' },
  { id: 'automod', description: 'Bad-word filter and auto-moderation' },
  { id: 'logs', description: 'Server logging' },
  { id: 'welcome', description: 'Welcome and goodbye' },
  { id: 'invites', description: 'Invite tracking' },
  { id: 'verification', description: 'Verification' },
  { id: 'levels', description: 'XP, levels and auto rank' },
  { id: 'tickets', description: 'Tickets' },
  { id: 'voice', description: 'Join to Create voice' },
  { id: 'youtube', description: 'YouTube notifications' },
  { id: 'autoresponder', description: 'Autoresponders' },
  { id: 'emoji', description: 'Emoji steal' },
  { id: 'music', description: 'Music' },
];

export const MODULE_IDS = new Set(MODULES.map((m) => m.id));
export const isOwnerOnly = (m: string) => MODULES.find((x) => x.id === m)?.ownerOnly === true;
export const GRANTABLE_MODULES = MODULES.filter((m) => !m.ownerOnly).map((m) => m.id);

/** Defaults, before any per-guild overrides. Anti-Nuke is NOT a super-admin. */
export const DEFAULT_GRANTS: Record<SpecialRoleKind, string[]> = {
  admin: GRANTABLE_MODULES,
  mod: ['moderation', 'automod', 'logs'],
  antinuke: ['antinuke', 'honeypot'],
};

/** overrides[kind][module] = true (allow) | false (deny) */
export type Overrides = Partial<Record<SpecialRoleKind, Record<string, boolean>>>;

export function isKindAllowed(kind: SpecialRoleKind, module: string, overrides: Overrides): boolean {
  if (isOwnerOnly(module)) return false;
  const o = overrides[kind]?.[module];
  return o ?? DEFAULT_GRANTS[kind].includes(module);
}

export function effectiveModules(kind: SpecialRoleKind, overrides: Overrides): string[] {
  return GRANTABLE_MODULES.filter((m) => isKindAllowed(kind, m, overrides));
}

export interface AuthInput {
  /** userId === OWNER_ID from env. Never derived from client input. */
  isOwner: boolean;
  /** Discord server owner. Treated as Admin tier, never as bot owner. */
  isServerOwner: boolean;
  kinds: SpecialRoleKind[];
  module: string | null;
  overrides: Overrides;
}

export function isAllowed(i: AuthInput): boolean {
  if (i.module === null) return true; // public command
  if (i.isOwner) return true;
  const module = i.module;
  if (!MODULE_IDS.has(module) || isOwnerOnly(module)) return false;

  const kinds = new Set<SpecialRoleKind>(i.kinds);
  if (i.isServerOwner) kinds.add('admin');

  const list = [...kinds];
  if (list.some((k) => i.overrides[k]?.[module] === false)) return false; // explicit deny wins
  return list.some((k) => isKindAllowed(k, module, i.overrides));
}
