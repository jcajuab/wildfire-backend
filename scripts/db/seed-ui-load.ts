import { spawn } from "node:child_process";
import {
  generateKeyPairSync,
  type KeyObject,
  sign as signPayload,
} from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { faker } from "@faker-js/faker";

const API_BASE_URL =
  process.env.SEED_API_BASE_URL?.replace(/\/+$/, "") ??
  "http://localhost:8000/v1";
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const SEED = Number(process.env.SEED_UI_LOAD_SEED ?? "20260511");

const DISPLAY_COUNT = parseCount("SEED_DISPLAY_COUNT", 100);
const NON_FLASH_CONTENT_COUNT = parseCount("SEED_CONTENT_COUNT", 500);
const FLASH_CONTENT_COUNT = parseCount("SEED_FLASH_COUNT", 500);
const PLAYLIST_COUNT = parseCount("SEED_PLAYLIST_COUNT", 100);
const SCHEDULE_COUNT = parseCount("SEED_SCHEDULE_COUNT", 500);
const PLAYLIST_ITEMS_PER_PLAYLIST = parseCount("SEED_PLAYLIST_ITEM_COUNT", 5);

const CONTENT_UPLOAD_CONCURRENCY = parseCount("SEED_UPLOAD_CONCURRENCY", 6);
const CONTENT_CREATE_CONCURRENCY = parseCount("SEED_CONTENT_CONCURRENCY", 12);
const DISPLAY_CREATE_CONCURRENCY = parseCount("SEED_DISPLAY_CONCURRENCY", 8);
const POLL_TIMEOUT_MS = parseCount("SEED_JOB_TIMEOUT_MS", 120_000);
const POLL_INTERVAL_MS = parseCount("SEED_JOB_POLL_INTERVAL_MS", 1_000);

const MEDIA_WIDTH = 640;
const MEDIA_HEIGHT = 360;
const VIDEO_DURATION_SECONDS = 2;
const MAX_PLAYLIST_DURATION_SECONDS = 60;
const SCHEDULE_TIMEZONE =
  process.env.SEED_SCHEDULE_TIMEZONE ??
  process.env.SCHEDULE_TIMEZONE ??
  "Asia/Manila";

const OUTPUTS = [
  { type: "DP", index: 0 },
  { type: "DVI", index: 0 },
  { type: "HDMI", index: 0 },
  { type: "VGA", index: 0 },
] as const;
const FLASH_TONES = ["INFO", "WARNING", "CRITICAL"] as const;
const DISPLAY_GROUPS = [
  "Main Building",
  "Academic Wing",
  "Student Services",
  "Athletics",
  "Library",
  "Cafeteria",
  "Engineering",
  "Science Hall",
  "Administration",
  "Outdoor",
] as const;

type ApiEnvelope<T> = { data: T };
type ApiListResponse<T> = {
  data: T[];
  meta?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};
type LoginResponse = {
  accessToken: string;
  user: {
    id: string;
    username: string;
  };
};
type IdName = { id: string; name: string };
type ContentType = "IMAGE" | "VIDEO" | "FLASH" | "TEXT";
type ContentStatus = "PROCESSING" | "READY" | "FAILED";
type ContentItem = {
  id: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
};
type ContentJob = {
  id: string;
  contentId: string;
  status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  errorMessage: string | null;
};
type UploadContentResponse = {
  content: ContentItem;
  job: ContentJob;
};
type PlaylistItemInput = {
  contentId: string;
  duration: number;
  loop: boolean;
};
type Playlist = {
  id: string;
  name: string;
};
type Display = {
  id: string;
  name: string;
  slug?: string;
};
type Schedule = {
  id: string;
  name: string;
};
type RegistrationLink = {
  token: string;
};
type RegistrationLinkMetadata = {
  slug: string;
  output: string;
  challengeNonce: string;
};
type RegisteredDisplay = {
  displayId: string;
  slug: string;
};
type MediaAsset = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};
type SeedContent = {
  playable: ContentItem[];
  flash: ContentItem[];
};
type ScheduleWindow = {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  kind: "PLAYLIST" | "FLASH";
};

class ApiClient {
  private accessToken: string | null = null;

  constructor(private readonly baseUrl: string) {}

  async login(input: { username: string; password: string }) {
    const response = await this.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: input,
      authenticate: false,
    });
    this.accessToken = response.accessToken;
    return response;
  }

  async get<T>(path: string, query?: Record<string, string | number>) {
    return this.request<T>(withQuery(path, query), { method: "GET" });
  }

  async post<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  async put<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "PUT", body });
  }

  async delete(path: string) {
    await this.request<void>(path, { method: "DELETE" });
  }

  async upload<T>(path: string, formData: FormData) {
    return this.request<T>(path, { method: "POST", formData });
  }

  private async request<T>(
    path: string,
    options: {
      method: string;
      body?: unknown;
      formData?: FormData;
      authenticate?: boolean;
    },
  ): Promise<T> {
    const headers = new Headers();
    if (options.authenticate !== false) {
      if (!this.accessToken) {
        throw new Error("Seed API client is not authenticated.");
      }
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method,
      headers,
      body:
        options.formData ??
        (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    const payload = text.length > 0 ? safeJsonParse(text) : null;
    if (!response.ok) {
      throw new Error(
        `${options.method} ${path} failed with ${response.status}: ${formatErrorPayload(
          payload,
          text,
        )}`,
      );
    }

    if (
      payload &&
      typeof payload === "object" &&
      "data" in payload &&
      !Array.isArray(payload)
    ) {
      return (payload as ApiEnvelope<T>).data;
    }
    return payload as T;
  }
}

function parseCount(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatErrorPayload(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error &&
    "message" in payload.error
  ) {
    return String(payload.error.message);
  }
  return fallback || "empty response";
}

function withQuery(
  path: string,
  query?: Record<string, string | number>,
): string {
  if (!query) {
    return path;
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    searchParams.set(key, String(value));
  }
  const queryString = searchParams.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function pad(value: number, width = 3): string {
  return String(value).padStart(width, "0");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 100);
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function cyclicValue<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  if (value === undefined) {
    throw new Error("Cannot read from an empty value list.");
  }
  return value;
}

function buildPlaylistDurations(itemCount: number): number[] {
  if (itemCount > MAX_PLAYLIST_DURATION_SECONDS) {
    throw new Error(
      `SEED_PLAYLIST_ITEM_COUNT cannot exceed ${MAX_PLAYLIST_DURATION_SECONDS}; playlist item durations must be positive and total no more than ${MAX_PLAYLIST_DURATION_SECONDS} seconds.`,
    );
  }

  if (itemCount === 5) {
    return [8, 10, 12, 14, 16];
  }

  const baseDuration = Math.floor(MAX_PLAYLIST_DURATION_SECONDS / itemCount);
  const remainder = MAX_PLAYLIST_DURATION_SECONDS - baseDuration * itemCount;
  return Array.from(
    { length: itemCount },
    (_, index) => baseDuration + (index < remainder ? 1 : 0),
  );
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, values.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        const value = values[index];
        if (value !== undefined) {
          results[index] = await mapper(value, index);
        }
      }
    }),
  );

  return results;
}

async function runFfmpeg(args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stderrChunks: Buffer[] = [];
    const child = spawn("ffmpeg", [...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `ffmpeg exited with code ${code ?? "unknown"}: ${Buffer.concat(
            stderrChunks,
          ).toString("utf8")}`,
        ),
      );
    });
  });
}

async function generateMediaAssets(): Promise<{
  images: MediaAsset[];
  videos: MediaAsset[];
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "wildfire-ui-load-"));
  const imageThemes = [
    "Campus Notice",
    "Student Event",
    "Library Hours",
    "Cafeteria Menu",
    "Safety Reminder",
    "Sports Update",
    "Exam Schedule",
    "Club Meeting",
    "Welcome Board",
  ];
  const videoThemes = [
    "Morning Bulletin",
    "Event Highlights",
    "Campus Loop",
    "Announcement Reel",
  ];

  try {
    const images = await Promise.all(
      imageThemes.map(async (theme, index) => {
        const filePath = join(tempDir, `image-${index}.png`);
        const color = faker.color.rgb({ prefix: "0x", casing: "lower" });
        const text = theme.replace(/:/g, "");
        try {
          await runFfmpeg([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            `color=c=${color}:s=${MEDIA_WIDTH}x${MEDIA_HEIGHT}:d=0.1`,
            "-vf",
            `drawtext=text='${text}':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=(h-text_h)/2`,
            "-frames:v",
            "1",
            "-y",
            filePath,
          ]);
        } catch {
          await runFfmpeg([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            `color=c=${color}:s=${MEDIA_WIDTH}x${MEDIA_HEIGHT}:d=0.1`,
            "-frames:v",
            "1",
            "-y",
            filePath,
          ]);
        }
        return {
          filename: `${slugify(theme)}.png`,
          mimeType: "image/png",
          bytes: new Uint8Array(await readFile(filePath)),
        };
      }),
    );

    const videos = await Promise.all(
      videoThemes.map(async (theme, index) => {
        const filePath = join(tempDir, `video-${index}.mp4`);
        try {
          await runFfmpeg([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            `testsrc=size=${MEDIA_WIDTH}x${MEDIA_HEIGHT}:rate=30:duration=${VIDEO_DURATION_SECONDS}`,
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-movflags",
            "+faststart",
            "-y",
            filePath,
          ]);
        } catch {
          await runFfmpeg([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            `testsrc=size=${MEDIA_WIDTH}x${MEDIA_HEIGHT}:rate=30:duration=${VIDEO_DURATION_SECONDS}`,
            "-c:v",
            "mpeg4",
            "-q:v",
            "5",
            "-movflags",
            "+faststart",
            "-y",
            filePath,
          ]);
        }
        return {
          filename: `${slugify(theme)}.mp4`,
          mimeType: "video/mp4",
          bytes: new Uint8Array(await readFile(filePath)),
        };
      }),
    );

    return { images, videos };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function requireCredentials() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error(
      [
        "Missing seed credentials.",
        "Run with SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD.",
        "Example: SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=replace_with_secure_secret bun run db:seed-ui-load",
      ].join("\n"),
    );
  }
  return { username: ADMIN_USERNAME, password: ADMIN_PASSWORD };
}

async function listFirstPage<T>(
  client: ApiClient,
  path: string,
  query?: Record<string, string | number>,
): Promise<T[]> {
  const response = await client.get<ApiListResponse<T> | T[]>(path, {
    page: 1,
    pageSize: 100,
    ...query,
  });
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response.data)) {
    return response.data;
  }
  throw new Error(`Unexpected list response shape from ${path}.`);
}

async function deleteUntilEmpty<T extends { id: string }>(
  client: ApiClient,
  options: {
    listPath: string;
    deleteItem: (client: ApiClient, id: string) => Promise<void>;
    label: string;
    query?: Record<string, string | number>;
  },
): Promise<number> {
  let deleted = 0;
  while (true) {
    const items = await listFirstPage<T>(
      client,
      options.listPath,
      options.query,
    );
    if (items.length === 0) {
      return deleted;
    }
    await mapWithConcurrency(items, 10, async (item) => {
      await options.deleteItem(client, item.id);
      deleted += 1;
    });
    process.stdout.write(`\rDeleted ${deleted} ${options.label}...`);
  }
}

async function resetDomains(client: ApiClient) {
  console.log(
    "Resetting schedules, playlists, content, displays, and groups...",
  );
  for (let slotIndex = 1; slotIndex <= 5; slotIndex += 1) {
    await client
      .delete(`/displays/emergency-slots/${slotIndex}`)
      .catch(() => {});
  }

  const schedulesDeleted = await deleteUntilEmpty<Schedule>(client, {
    listPath: "/schedules",
    deleteItem: (api, id) => api.delete(`/schedules/${id}`),
    label: "schedules",
  });
  process.stdout.write("\n");

  const playlistsDeleted = await deleteUntilEmpty<Playlist>(client, {
    listPath: "/playlists",
    deleteItem: (api, id) => api.delete(`/playlists/${id}`),
    label: "playlists",
  });
  process.stdout.write("\n");

  const contentDeleted = await deleteUntilEmpty<ContentItem>(client, {
    listPath: "/content",
    deleteItem: (api, id) => api.delete(`/content/${id}`),
    label: "content items",
  });
  process.stdout.write("\n");

  const displaysDeleted = await deleteUntilEmpty<Display>(client, {
    listPath: "/displays",
    deleteItem: (api, id) => api.post(`/displays/${id}/unregister`),
    label: "displays",
  });
  process.stdout.write("\n");

  const groupsDeleted = await deleteUntilEmpty<IdName>(client, {
    listPath: "/displays/groups",
    deleteItem: (api, id) => api.delete(`/displays/groups/${id}`),
    label: "display groups",
  });
  process.stdout.write("\n");

  console.log(
    `Reset complete: ${schedulesDeleted} schedules, ${playlistsDeleted} playlists, ${contentDeleted} content, ${displaysDeleted} displays, ${groupsDeleted} groups.`,
  );
}

function createTextContentPayload(index: number) {
  const title = `${faker.company.catchPhraseAdjective()} ${faker.word.noun()} notice`;
  const lead = faker.lorem.sentence({ min: 8, max: 14 });
  const detail = faker.lorem.sentence({ min: 10, max: 18 });
  const htmlContent = `<h2>${htmlEscape(title)}</h2><p>${htmlEscape(
    lead,
  )}</p><p>${htmlEscape(detail)}</p>`;
  const jsonContent = JSON.stringify({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2, textAlign: "left" },
        content: [{ type: "text", text: title }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: lead }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: detail }],
      },
    ],
  });

  return {
    title: `${title} ${pad(index)}`,
    htmlContent,
    jsonContent,
  };
}

async function createTextContent(client: ApiClient, index: number) {
  return client.post<ContentItem>(
    "/content/text",
    createTextContentPayload(index),
  );
}

async function createFlashContent(client: ApiClient, index: number) {
  const place = faker.helpers.arrayElement([
    "main lobby",
    "library entrance",
    "student center",
    "gymnasium",
    "auditorium",
    "science hall",
  ]);
  return client.post<ContentItem>("/content/flash", {
    title: `${faker.helpers.arrayElement([
      "Campus Alert",
      "Schedule Reminder",
      "Service Notice",
      "Event Update",
      "Safety Advisory",
    ])} ${pad(index)}`,
    message: faker.helpers.arrayElement([
      `Please proceed to the ${place} for the scheduled activity.`,
      `Reminder: keep pathways clear near the ${place}.`,
      `The ${place} has an updated announcement for today.`,
      `Staff assistance is available at the ${place}.`,
    ]),
    tone: cyclicValue(FLASH_TONES, index - 1),
  });
}

async function uploadContent(
  client: ApiClient,
  input: { title: string; asset: MediaAsset },
) {
  const formData = new FormData();
  formData.set("title", input.title);
  formData.set(
    "file",
    new File([input.asset.bytes], input.asset.filename, {
      type: input.asset.mimeType,
    }),
  );
  const result = await client.upload<UploadContentResponse>(
    "/content",
    formData,
  );
  await waitForContentJob(client, result.job.id);
  return client.get<ContentItem>(`/content/${result.content.id}`);
}

async function waitForContentJob(client: ApiClient, jobId: string) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const job = await client.get<ContentJob>(`/content-jobs/${jobId}`);
    if (job.status === "SUCCEEDED") {
      return;
    }
    if (job.status === "FAILED") {
      throw new Error(
        `Content ingestion job ${jobId} failed: ${job.errorMessage ?? "unknown error"}`,
      );
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for content ingestion job ${jobId}.`);
}

async function createContent(client: ApiClient): Promise<SeedContent> {
  const mediaAssets = await generateMediaAssets();
  const textCount = Math.ceil(NON_FLASH_CONTENT_COUNT / 3);
  const imageCount = Math.ceil((NON_FLASH_CONTENT_COUNT - textCount) / 2);
  const videoCount = NON_FLASH_CONTENT_COUNT - textCount - imageCount;
  const textIndexes = Array.from(
    { length: textCount },
    (_, index) => index + 1,
  );
  const imageIndexes = Array.from(
    { length: imageCount },
    (_, index) => index + 1,
  );
  const videoIndexes = Array.from(
    { length: videoCount },
    (_, index) => index + 1,
  );
  const flashIndexes = Array.from(
    { length: FLASH_CONTENT_COUNT },
    (_, index) => index + 1,
  );

  console.log(`Creating ${textCount} text content items...`);
  const textContent = await mapWithConcurrency(
    textIndexes,
    CONTENT_CREATE_CONCURRENCY,
    (index) => createTextContent(client, index),
  );

  console.log(
    `Creating ${imageCount} image content items through upload route...`,
  );
  const imageContent = await mapWithConcurrency(
    imageIndexes,
    CONTENT_UPLOAD_CONCURRENCY,
    (index) =>
      uploadContent(client, {
        title: `${faker.commerce.productAdjective()} campus poster ${pad(index)}`,
        asset: cyclicValue(mediaAssets.images, index - 1),
      }),
  );

  console.log(
    `Creating ${videoCount} video content items through upload route...`,
  );
  const videoContent = await mapWithConcurrency(
    videoIndexes,
    CONTENT_UPLOAD_CONCURRENCY,
    (index) =>
      uploadContent(client, {
        title: `${faker.company.buzzPhrase()} video loop ${pad(index)}`,
        asset: cyclicValue(mediaAssets.videos, index - 1),
      }),
  );

  console.log(`Creating ${FLASH_CONTENT_COUNT} flash content items...`);
  const flashContent = await mapWithConcurrency(
    flashIndexes,
    CONTENT_CREATE_CONCURRENCY,
    (index) => createFlashContent(client, index),
  );

  return {
    playable: [...textContent, ...imageContent, ...videoContent],
    flash: flashContent,
  };
}

function createDisplayName(index: number) {
  return `${faker.helpers.arrayElement([
    "Lobby",
    "Auditorium",
    "Cafeteria",
    "Library",
    "Engineering",
    "Science",
    "Gymnasium",
    "Student Center",
    "Registrar",
    "Hallway",
  ])} ${faker.helpers.arrayElement([
    "North",
    "South",
    "East",
    "West",
    "Main",
    "Annex",
    "Stage",
    "Entrance",
  ])} ${pad(index)}`;
}

async function registerDisplay(
  client: ApiClient,
  index: number,
): Promise<Display> {
  const name = createDisplayName(index);
  const slug = `${slugify(name)}-${pad(index)}`;
  const output = cyclicValue(OUTPUTS, index - 1);
  const groupName = cyclicValue(DISPLAY_GROUPS, index - 1);
  const link = await client.post<RegistrationLink>(
    "/displays/registration-links",
    {
      slug,
      displayName: name,
      outputType: output.type,
      outputIndex: output.index,
      displayGroups: [groupName],
    },
  );
  const metadata = await client.get<RegistrationLinkMetadata>(
    `/displays/registration-links/${link.token}`,
  );
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  const fingerprint = `ui-load-${slug}-${faker.string.alphanumeric(16).toLowerCase()}`;
  const signature = signRegistrationLink({
    token: link.token,
    metadata,
    fingerprint,
    publicKeyPem,
    privateKey,
  });
  const registered = await client.post<RegisteredDisplay>(
    `/displays/registration-links/${link.token}/claim`,
    {
      fingerprint,
      publicKey: publicKeyPem,
      keyAlgorithm: "ed25519",
      registrationSignature: signature,
    },
  );
  return {
    id: registered.displayId,
    slug: registered.slug,
    name,
  };
}

function signRegistrationLink(input: {
  token: string;
  metadata: RegistrationLinkMetadata;
  fingerprint: string;
  publicKeyPem: string;
  privateKey: KeyObject;
}) {
  const payload = [
    "REGISTRATION",
    input.token,
    input.metadata.challengeNonce,
    input.metadata.slug,
    input.metadata.output,
    input.fingerprint,
    input.publicKeyPem,
  ].join("\n");
  const signature = signPayload(
    null,
    Buffer.from(payload, "utf8"),
    input.privateKey,
  );
  return toBase64Url(signature);
}

async function createDisplays(client: ApiClient): Promise<Display[]> {
  const displayIndexes = Array.from(
    { length: DISPLAY_COUNT },
    (_, index) => index + 1,
  );
  console.log(
    `Registering ${DISPLAY_COUNT} displays through registration links...`,
  );
  return mapWithConcurrency(
    displayIndexes,
    DISPLAY_CREATE_CONCURRENCY,
    (index) => registerDisplay(client, index),
  );
}

async function createPlaylists(
  client: ApiClient,
  playableContent: readonly ContentItem[],
): Promise<Playlist[]> {
  if (playableContent.length === 0) {
    throw new Error("Cannot create playlists without playable content.");
  }
  const playlistIndexes = Array.from(
    { length: PLAYLIST_COUNT },
    (_, index) => index + 1,
  );
  console.log(`Creating ${PLAYLIST_COUNT} playlists...`);
  const durations = buildPlaylistDurations(PLAYLIST_ITEMS_PER_PLAYLIST);
  return mapWithConcurrency(playlistIndexes, 8, async (index) => {
    const items: PlaylistItemInput[] = Array.from(
      { length: PLAYLIST_ITEMS_PER_PLAYLIST },
      (_, itemIndex) => {
        const content = cyclicValue(
          playableContent,
          (index - 1) * PLAYLIST_ITEMS_PER_PLAYLIST + itemIndex,
        );
        return {
          contentId: content.id,
          duration: cyclicValue(durations, itemIndex),
          loop:
            content.type === "VIDEO" &&
            itemIndex === PLAYLIST_ITEMS_PER_PLAYLIST - 1,
        };
      },
    );
    return client.post<Playlist>("/playlists", {
      name: `${faker.helpers.arrayElement([
        "Morning Loop",
        "Campus Bulletin",
        "Student Life",
        "Event Rotation",
        "Main Hall",
        "Evening Notices",
      ])} ${pad(index)}`,
      description: faker.lorem.sentence({ min: 6, max: 12 }),
      showCounter: index % 2 === 0,
      items,
    });
  });
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) {
      throw new Error(`Unable to resolve ${type} for ${timeZone}`);
    }
    return value;
  };
  const rawHour = Number(getPart("hour"));
  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(getPart("minute")),
  };
}

function toZonedDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${month}-${day}`;
}

function toZonedMinuteOfDay(date: Date, timeZone: string): number {
  const { hour, minute } = getZonedParts(date, timeZone);
  return hour * 60 + minute;
}

function toTimeKey(minuteOfDay: number): string {
  const normalized = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${pad(Math.trunc(normalized / 60), 2)}:${pad(normalized % 60, 2)}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildScheduleWindows(
  now: Date,
  slotsPerDisplay: number,
): ScheduleWindow[] {
  const currentMinute = toZonedMinuteOfDay(now, SCHEDULE_TIMEZONE);
  let dayOffset = 0;
  let startMinute = Math.ceil((currentMinute + 5) / 5) * 5;

  return Array.from({ length: slotsPerDisplay }, (_, index) => {
    if (startMinute + 45 >= 24 * 60) {
      dayOffset += 1;
      startMinute = 8 * 60;
    }

    const windowDate = addDays(now, dayOffset);
    const window = {
      startDate: toZonedDateKey(windowDate, SCHEDULE_TIMEZONE),
      endDate: toZonedDateKey(addDays(windowDate, 6), SCHEDULE_TIMEZONE),
      startTime: toTimeKey(startMinute),
      endTime: toTimeKey(startMinute + 45),
      kind: index % 2 === 0 ? "PLAYLIST" : "FLASH",
    } satisfies ScheduleWindow;

    startMinute += 50;
    return window;
  });
}

async function createSchedules(
  client: ApiClient,
  input: {
    displays: readonly Display[];
    playlists: readonly Playlist[];
    flashContent: readonly ContentItem[];
  },
) {
  if (
    input.displays.length === 0 ||
    input.playlists.length === 0 ||
    input.flashContent.length === 0
  ) {
    throw new Error(
      "Displays, playlists, and flash content are required before schedules can be seeded.",
    );
  }
  const now = new Date();
  const slotsPerDisplay = Math.max(
    1,
    Math.ceil(SCHEDULE_COUNT / input.displays.length),
  );
  const windows = buildScheduleWindows(now, slotsPerDisplay);
  const scheduleIndexes = Array.from(
    { length: SCHEDULE_COUNT },
    (_, index) => index,
  );

  console.log(`Creating ${SCHEDULE_COUNT} schedules...`);
  await mapWithConcurrency(scheduleIndexes, 8, async (zeroIndex) => {
    const display = cyclicValue(input.displays, zeroIndex);
    const window = cyclicValue(
      windows,
      Math.floor(zeroIndex / input.displays.length),
    );
    const scheduleNumber = pad(zeroIndex + 1);
    const isPlaylist = window.kind === "PLAYLIST";
    const playlist = cyclicValue(input.playlists, zeroIndex);
    const flash = cyclicValue(input.flashContent, zeroIndex);

    await client.post<Schedule>("/schedules", {
      name: `${isPlaylist ? "Playlist" : "Flash"} rotation ${scheduleNumber}`,
      kind: window.kind,
      playlistId: isPlaylist ? playlist.id : null,
      contentId: isPlaylist ? null : flash.id,
      displayId: display.id,
      startDate: window.startDate,
      endDate: window.endDate,
      startTime: window.startTime,
      endTime: window.endTime,
    });
  });
}

async function setEmergencySlots(
  client: ApiClient,
  emergencyContent: readonly ContentItem[],
) {
  const eligibleContent = emergencyContent.filter(
    (content) =>
      content.status === "READY" &&
      (content.type === "IMAGE" ||
        content.type === "VIDEO" ||
        content.type === "TEXT"),
  );
  if (eligibleContent.length < 5) {
    throw new Error(
      `Expected at least 5 READY image, video, or text assets for emergency slots, found ${eligibleContent.length}.`,
    );
  }

  const labels = [
    "Fire Drill",
    "Earthquake",
    "Power Advisory",
    "Weather Alert",
    "Security Notice",
  ];
  for (let slotIndex = 1; slotIndex <= 5; slotIndex += 1) {
    const content = cyclicValue(eligibleContent, slotIndex - 1);
    await client.put(`/displays/emergency-slots/${slotIndex}`, {
      label: labels[slotIndex - 1],
      contentId: content.id,
    });
  }
}

async function main(): Promise<void> {
  faker.seed(SEED);
  const credentials = requireCredentials();
  const client = new ApiClient(API_BASE_URL);

  console.log(`Using API: ${API_BASE_URL}`);
  const login = await client.login(credentials);
  console.log(`Authenticated as ${login.user.username} (${login.user.id}).`);

  await resetDomains(client);

  const displays = await createDisplays(client);
  const content = await createContent(client);
  const playlists = await createPlaylists(client, content.playable);
  await createSchedules(client, {
    displays,
    playlists,
    flashContent: content.flash,
  });
  await setEmergencySlots(client, content.playable);

  console.log("Done. Seeded UI load dataset through API routes:");
  console.log(`- ${displays.length} displays`);
  console.log(`- ${DISPLAY_GROUPS.length} display groups`);
  console.log(`- ${content.playable.length} non-flash content items`);
  console.log(`- ${content.flash.length} flash content items`);
  console.log(`- ${playlists.length} playlists`);
  console.log(
    `- ${playlists.length * PLAYLIST_ITEMS_PER_PLAYLIST} playlist items`,
  );
  console.log(`- ${SCHEDULE_COUNT} schedules`);
  console.log("- 5 emergency asset slots");
}

if (import.meta.main) {
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    exitCode = 1;
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(exitCode);
}
