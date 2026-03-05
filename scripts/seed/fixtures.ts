import {
  DEMO_AUDIT_REQUEST_ID_PREFIX,
  DEMO_CONTENT_KEY_PREFIX,
  DEMO_DEFAULT_USER_PASSWORD,
  DEMO_DISPLAY_SLUG_PREFIX,
  DEMO_GROUP_PREFIX,
  DEMO_PLAYLIST_PREFIX,
  DEMO_ROLE_PREFIX,
  DEMO_SCHEDULE_PREFIX,
} from "./constants";

const fromBase64 = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value, "base64"));

const fromText = (value: string): Uint8Array => new TextEncoder().encode(value);

export interface DemoRoleFixture {
  key: "operator" | "content_manager" | "auditor";
  name: string;
  description: string;
  permissionKeys: string[];
}

export interface DemoUserFixture {
  username: string;
  email: string;
  name: string;
  roleKeys: DemoRoleFixture["key"][];
  password: string;
}

export interface DemoDisplayFixture {
  slug: string;
  name: string;
  location: string | null;
  displayFingerprint: string;
  displayOutput: string;
  screenWidth: number;
  screenHeight: number;
  orientation: "LANDSCAPE" | "PORTRAIT";
  status: "PROCESSING" | "READY" | "LIVE" | "DOWN";
}

export interface DemoDisplayGroupFixture {
  name: string;
  colorIndex: number;
  displaySlugs: string[];
}

export interface DemoContentFixture {
  id: string;
  title: string;
  mimeType: "image/png" | "application/pdf";
  type: "IMAGE" | "PDF";
  width: number | null;
  height: number | null;
  duration: number | null;
  fileKey: string;
  body: Uint8Array;
}

export interface DemoPlaylistFixture {
  name: string;
  description: string;
  status: "DRAFT" | "IN_USE";
  items: Array<{
    contentId: string;
    sequence: number;
    duration: number;
  }>;
}

export interface DemoScheduleFixture {
  name: string;
  playlistName: string;
  displaySlug: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  priority: number;
  isActive: boolean;
}

export interface DemoAuditFixture {
  requestId: string;
  action: string;
  route: string;
  method: string;
  path: string;
  status: number;
  actorUserUsername?: string;
  actorDisplaySlug?: string;
  resourceType?: string;
  resourceDisplaySlug?: string;
  resourceContentId?: string;
  resourcePlaylistName?: string;
  resourceScheduleName?: string;
  metadata: Record<string, unknown>;
}

export const DEMO_ROLES: DemoRoleFixture[] = [
  {
    key: "operator",
    name: `${DEMO_ROLE_PREFIX}Operator`,
    description: "Operate displays and schedules in local development.",
    permissionKeys: [
      "displays:read",
      "displays:update",
      "playlists:read",
      "schedules:read",
      "schedules:update",
      "content:read",
    ],
  },
  {
    key: "content_manager",
    name: `${DEMO_ROLE_PREFIX}Content Manager`,
    description: "Manage content and playlists in local development.",
    permissionKeys: [
      "content:create",
      "content:read",
      "content:update",
      "content:delete",
      "playlists:create",
      "playlists:read",
      "playlists:update",
      "playlists:delete",
      "schedules:read",
    ],
  },
  {
    key: "auditor",
    name: `${DEMO_ROLE_PREFIX}Auditor`,
    description: "Review audit logs and module state in local development.",
    permissionKeys: [
      "audit:read",
      "displays:read",
      "content:read",
      "playlists:read",
      "schedules:read",
      "users:read",
      "roles:read",
    ],
  },
];

const demoPassword =
  process.env.DEMO_USER_PASSWORD?.trim() || DEMO_DEFAULT_USER_PASSWORD;

export const DEMO_USERS: DemoUserFixture[] = [
  {
    username: "demo.operator",
    email: "demo.operator@demo.local",
    name: "Demo Operator",
    roleKeys: ["operator"],
    password: demoPassword,
  },
  {
    username: "demo.content",
    email: "demo.content@demo.local",
    name: "Demo Content",
    roleKeys: ["content_manager"],
    password: demoPassword,
  },
  {
    username: "demo.auditor",
    email: "demo.auditor@demo.local",
    name: "Demo Auditor",
    roleKeys: ["auditor"],
    password: demoPassword,
  },
];

export const DEMO_DISPLAYS: DemoDisplayFixture[] = [
  {
    slug: `${DEMO_DISPLAY_SLUG_PREFIX}lobby-east`,
    name: "Demo Lobby East",
    location: "HQ Lobby East",
    displayFingerprint: "demo-lobby-east-fp",
    displayOutput: "hdmi-a",
    screenWidth: 1920,
    screenHeight: 1080,
    orientation: "LANDSCAPE",
    status: "LIVE",
  },
  {
    slug: `${DEMO_DISPLAY_SLUG_PREFIX}lobby-west`,
    name: "Demo Lobby West",
    location: "HQ Lobby West",
    displayFingerprint: "demo-lobby-west-fp",
    displayOutput: "hdmi-a",
    screenWidth: 1920,
    screenHeight: 1080,
    orientation: "LANDSCAPE",
    status: "READY",
  },
  {
    slug: `${DEMO_DISPLAY_SLUG_PREFIX}breakroom`,
    name: "Demo Breakroom",
    location: "HQ Breakroom",
    displayFingerprint: "demo-breakroom-fp",
    displayOutput: "dp-1",
    screenWidth: 1080,
    screenHeight: 1920,
    orientation: "PORTRAIT",
    status: "READY",
  },
];

export const DEMO_DISPLAY_GROUPS: DemoDisplayGroupFixture[] = [
  {
    name: `${DEMO_GROUP_PREFIX}Lobby`,
    colorIndex: 1,
    displaySlugs: [
      `${DEMO_DISPLAY_SLUG_PREFIX}lobby-east`,
      `${DEMO_DISPLAY_SLUG_PREFIX}lobby-west`,
    ],
  },
  {
    name: `${DEMO_GROUP_PREFIX}Internal`,
    colorIndex: 2,
    displaySlugs: [`${DEMO_DISPLAY_SLUG_PREFIX}breakroom`],
  },
];

export const DEMO_CONTENT: DemoContentFixture[] = [
  {
    id: "00000000-0000-0000-0000-00000000c001",
    title: "Demo Lobby Hero",
    mimeType: "image/png",
    type: "IMAGE",
    width: 1,
    height: 1,
    duration: null,
    fileKey: `${DEMO_CONTENT_KEY_PREFIX}/demo-lobby-hero.png`,
    body: fromBase64(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0x8AAAAASUVORK5CYII=",
    ),
  },
  {
    id: "00000000-0000-0000-0000-00000000c002",
    title: "Demo Breakroom Notice",
    mimeType: "application/pdf",
    type: "PDF",
    width: null,
    height: null,
    duration: null,
    fileKey: `${DEMO_CONTENT_KEY_PREFIX}/demo-breakroom-notice.pdf`,
    body: fromText(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
    ),
  },
  {
    id: "00000000-0000-0000-0000-00000000c003",
    title: "Demo Operations Banner",
    mimeType: "image/png",
    type: "IMAGE",
    width: 1,
    height: 1,
    duration: null,
    fileKey: `${DEMO_CONTENT_KEY_PREFIX}/demo-operations-banner.png`,
    body: fromBase64(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAwUBAf0A8YkAAAAASUVORK5CYII=",
    ),
  },
];

export const DEMO_PLAYLISTS: DemoPlaylistFixture[] = [
  {
    name: `${DEMO_PLAYLIST_PREFIX}Lobby Rotation`,
    description: "Demo playlist for lobby displays.",
    status: "IN_USE",
    items: [
      {
        contentId: "00000000-0000-0000-0000-00000000c001",
        sequence: 1,
        duration: 15,
      },
      {
        contentId: "00000000-0000-0000-0000-00000000c003",
        sequence: 2,
        duration: 12,
      },
    ],
  },
  {
    name: `${DEMO_PLAYLIST_PREFIX}Breakroom Rotation`,
    description: "Demo playlist for breakroom displays.",
    status: "IN_USE",
    items: [
      {
        contentId: "00000000-0000-0000-0000-00000000c002",
        sequence: 1,
        duration: 30,
      },
    ],
  },
];

export const DEMO_SCHEDULES: DemoScheduleFixture[] = [
  {
    name: `${DEMO_SCHEDULE_PREFIX}Lobby Daytime`,
    playlistName: `${DEMO_PLAYLIST_PREFIX}Lobby Rotation`,
    displaySlug: `${DEMO_DISPLAY_SLUG_PREFIX}lobby-east`,
    startDate: "2024-01-01",
    endDate: "2099-12-31",
    startTime: "08:00",
    endTime: "18:00",
    priority: 100,
    isActive: true,
  },
  {
    name: `${DEMO_SCHEDULE_PREFIX}Lobby Mirror`,
    playlistName: `${DEMO_PLAYLIST_PREFIX}Lobby Rotation`,
    displaySlug: `${DEMO_DISPLAY_SLUG_PREFIX}lobby-west`,
    startDate: "2024-01-01",
    endDate: "2099-12-31",
    startTime: "08:00",
    endTime: "18:00",
    priority: 90,
    isActive: true,
  },
  {
    name: `${DEMO_SCHEDULE_PREFIX}Breakroom Workday`,
    playlistName: `${DEMO_PLAYLIST_PREFIX}Breakroom Rotation`,
    displaySlug: `${DEMO_DISPLAY_SLUG_PREFIX}breakroom`,
    startDate: "2024-01-01",
    endDate: "2099-12-31",
    startTime: "09:00",
    endTime: "17:00",
    priority: 80,
    isActive: true,
  },
];

export const DEMO_AUDIT_EVENTS: DemoAuditFixture[] = [
  {
    requestId: `${DEMO_AUDIT_REQUEST_ID_PREFIX}0001`,
    action: "displays.seed.register",
    route: "/displays",
    method: "POST",
    path: "/api/v1/displays",
    status: 201,
    actorUserUsername: "demo.operator",
    resourceType: "display",
    resourceDisplaySlug: `${DEMO_DISPLAY_SLUG_PREFIX}lobby-east`,
    metadata: { source: "db:seed", module: "displays" },
  },
  {
    requestId: `${DEMO_AUDIT_REQUEST_ID_PREFIX}0002`,
    action: "content.seed.upload",
    route: "/content",
    method: "POST",
    path: "/api/v1/content",
    status: 201,
    actorUserUsername: "demo.content",
    resourceType: "content",
    resourceContentId: "00000000-0000-0000-0000-00000000c001",
    metadata: { source: "db:seed", module: "content" },
  },
  {
    requestId: `${DEMO_AUDIT_REQUEST_ID_PREFIX}0003`,
    action: "playlists.seed.publish",
    route: "/playlists",
    method: "PATCH",
    path: "/api/v1/playlists/status",
    status: 200,
    actorUserUsername: "demo.content",
    resourceType: "playlist",
    resourcePlaylistName: `${DEMO_PLAYLIST_PREFIX}Lobby Rotation`,
    metadata: { source: "db:seed", module: "playlists" },
  },
  {
    requestId: `${DEMO_AUDIT_REQUEST_ID_PREFIX}0004`,
    action: "schedules.seed.assign",
    route: "/schedules",
    method: "POST",
    path: "/api/v1/schedules",
    status: 201,
    actorUserUsername: "demo.operator",
    resourceType: "schedule",
    resourceScheduleName: `${DEMO_SCHEDULE_PREFIX}Lobby Daytime`,
    metadata: { source: "db:seed", module: "schedules" },
  },
  {
    requestId: `${DEMO_AUDIT_REQUEST_ID_PREFIX}0005`,
    action: "audit.seed.export",
    route: "/audit/export",
    method: "GET",
    path: "/api/v1/audit/export",
    status: 200,
    actorUserUsername: "demo.auditor",
    resourceType: "audit",
    metadata: { source: "db:seed", module: "audit" },
  },
];
