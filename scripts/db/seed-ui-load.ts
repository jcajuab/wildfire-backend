import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { ADMIN_ROLE_NAME } from "#/domain/rbac/canonical-permissions";
import { env } from "#/env";
import { closeDbConnection, db } from "#/infrastructure/db/client";
import {
  content,
  contentAssets,
  contentFlashMessages,
  contentTextContent,
} from "#/infrastructure/db/schema/content.sql";
import { contentIngestionJobs } from "#/infrastructure/db/schema/content-job.sql";
import {
  displayActiveKeys,
  displayKeyPairs,
} from "#/infrastructure/db/schema/display-key.sql";
import {
  displayGroupMembers,
  displayGroups,
  displayRuntimeStates,
  displays,
} from "#/infrastructure/db/schema/displays.sql";
import { emergencySlots } from "#/infrastructure/db/schema/emergency-slots.sql";
import { playlists } from "#/infrastructure/db/schema/playlist.sql";
import { playlistItems } from "#/infrastructure/db/schema/playlist-item.sql";
import { roles, userRoles, users } from "#/infrastructure/db/schema/rbac.sql";
import {
  scheduleContentTargets,
  schedulePlaylistTargets,
  schedules,
} from "#/infrastructure/db/schema/schedule.sql";
import { S3ContentStorage } from "#/infrastructure/storage/s3-content.storage";
import { deterministicUuid, isSeedUuid } from "./seed-uuid";

const DISPLAY_COUNT = 100;
const NON_FLASH_CONTENT_COUNT = 500;
const TEXT_CONTENT_COUNT = 167;
const IMAGE_CONTENT_COUNT = 167;
const VIDEO_CONTENT_COUNT = 166;
const FLASH_CONTENT_COUNT = 500;
const PLAYLIST_COUNT = 100;
const PLAYLIST_ITEMS_PER_PLAYLIST = 5;
const SCHEDULES_PER_DISPLAY = 5;

const DISPLAY_OUTPUTS = ["hdmi-0", "dp-0", "dvi-0", "vga-0"] as const;
const DISPLAY_STATUSES = ["READY", "LIVE", "DOWN"] as const;
const FLASH_TONES = ["INFO", "WARNING", "CRITICAL"] as const;
const SCHEDULE_WINDOW_OFFSETS = [
  { startOffsetMinutes: 0, endOffsetMinutes: 45, kind: "PLAYLIST" },
  { startOffsetMinutes: 0, endOffsetMinutes: 50, kind: "PLAYLIST" },
  { startOffsetMinutes: 0, endOffsetMinutes: 55, kind: "FLASH" },
  { startOffsetMinutes: 60, endOffsetMinutes: 90, kind: "PLAYLIST" },
  { startOffsetMinutes: 120, endOffsetMinutes: 150, kind: "FLASH" },
] as const;
const MEDIA_WIDTH = 640;
const MEDIA_HEIGHT = 360;
const VIDEO_DURATION_SECONDS = 1;
const MEDIA_UPLOAD_CONCURRENCY = 16;

const checksum = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const pad = (value: number, width = 3): string =>
  String(value).padStart(width, "0");

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getZonedParts = (date: Date, timeZone: string) => {
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
  const getPart = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) {
      throw new Error(`Unable to resolve ${type} for ${timeZone}`);
    }
    return value;
  };

  const rawHour = Number(getPart("hour"));
  const hour = rawHour === 24 ? 0 : rawHour;

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
    hour,
    minute: Number(getPart("minute")),
  };
};

const toZonedDateKey = (date: Date, timeZone: string): string => {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${month}-${day}`;
};

const toZonedMinuteOfDay = (date: Date, timeZone: string): number => {
  const { hour, minute } = getZonedParts(date, timeZone);
  return hour * 60 + minute;
};

const toTimeKey = (minuteOfDay: number): string => {
  const normalized = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${pad(Math.trunc(normalized / 60), 2)}:${pad(normalized % 60, 2)}`;
};

const scheduleWindowsFromNow = (
  now: Date,
  timeZone: string,
): Array<{
  startTime: string;
  endTime: string;
  kind: "PLAYLIST" | "FLASH";
}> => {
  const currentMinute = toZonedMinuteOfDay(now, timeZone);
  return SCHEDULE_WINDOW_OFFSETS.map((window) => ({
    startTime: toTimeKey(currentMinute + window.startOffsetMinutes),
    endTime: toTimeKey(currentMinute + window.endOffsetMinutes),
    kind: window.kind,
  }));
};

const cyclicValue = <T>(values: readonly T[], index: number): T => {
  const value = values[index % values.length];
  if (value === undefined) {
    throw new Error("Cannot read from an empty seed value list");
  }
  return value;
};

async function insertChunks<T>(
  values: readonly T[],
  insertChunk: (chunk: T[]) => Promise<unknown>,
  chunkSize = 100,
): Promise<void> {
  for (let start = 0; start < values.length; start += chunkSize) {
    const chunk = values.slice(start, start + chunkSize);
    if (chunk.length > 0) {
      await insertChunk(chunk);
    }
  }
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, values.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (index < values.length) {
        const currentIndex = index;
        index += 1;
        const value = values[currentIndex];
        if (value !== undefined) {
          await mapper(value);
        }
      }
    }),
  );
}

async function runFfmpeg(args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stderrChunks: Buffer[] = [];
    const child = spawn("ffmpeg", [...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
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

async function generateSeedMediaAssets(): Promise<{
  image: Uint8Array;
  video: Uint8Array;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "wildfire-ui-load-"));
  const imagePath = join(tempDir, "seed-image.png");
  const videoPath = join(tempDir, "seed-video.mp4");

  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x0f6fff:s=${MEDIA_WIDTH}x${MEDIA_HEIGHT}:d=0.1`,
      "-frames:v",
      "1",
      "-y",
      imagePath,
    ]);

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
        videoPath,
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
        videoPath,
      ]);
    }

    const [image, video] = await Promise.all([
      readFile(imagePath),
      readFile(videoPath),
    ]);
    return {
      image: new Uint8Array(image),
      video: new Uint8Array(video),
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function createContentStorage(): S3ContentStorage {
  const endpoint = `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`;
  return new S3ContentStorage({
    bucket: env.MINIO_BUCKET,
    region: env.MINIO_REGION,
    endpoint,
    publicEndpoint: env.MINIO_PUBLIC_ENDPOINT,
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD,
    requestTimeoutMs: env.MINIO_REQUEST_TIMEOUT_MS,
  });
}

type MediaUpload = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

async function uploadMediaAssets(
  uploads: readonly MediaUpload[],
): Promise<void> {
  const uploadsByKey = new Map<string, MediaUpload>();
  for (const upload of uploads) {
    uploadsByKey.set(upload.key, upload);
  }

  const storage = createContentStorage();
  await storage.ensureBucketExists();
  await mapWithConcurrency(
    [...uploadsByKey.values()],
    MEDIA_UPLOAD_CONCURRENCY,
    (upload) =>
      storage.upload({
        key: upload.key,
        body: upload.body,
        contentType: upload.contentType,
        contentLength: upload.body.byteLength,
      }),
  );
}

async function findSeedOwner(): Promise<typeof users.$inferSelect> {
  const adminUserRows = await db
    .select()
    .from(users)
    .where(and(eq(users.username, "admin"), eq(users.isActive, true)))
    .limit(1);
  const adminUser = adminUserRows[0];
  if (adminUser) {
    return adminUser;
  }

  const adminRoleUserRows = await db
    .select({ user: users })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.name, ADMIN_ROLE_NAME), eq(users.isActive, true)))
    .limit(1);
  const adminRoleUser = adminRoleUserRows[0]?.user;
  if (adminRoleUser) {
    return adminRoleUser;
  }

  throw new Error(
    `No active admin user found. Sign in once or create an active "${ADMIN_ROLE_NAME}" user before running this seed.`,
  );
}

async function resetUiLoadDomains(now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schedulePlaylistTargets);
    await tx.delete(scheduleContentTargets);
    await tx.delete(schedules);
    await tx.delete(playlistItems);
    await tx.update(emergencySlots).set({ contentId: null, updatedAt: now });
    await tx.delete(contentIngestionJobs);
    await tx.delete(contentFlashMessages);
    await tx.delete(contentTextContent);
    await tx.delete(contentAssets);
    await tx.delete(content);
    await tx.delete(playlists);
    await tx.delete(displayActiveKeys);
    await tx.delete(displayKeyPairs);
    await tx.delete(displayGroupMembers);
    await tx.delete(displayRuntimeStates);
    await tx.delete(displayGroups);
    await tx.delete(displays);
  });
}

type SeedData = {
  displays: (typeof displays.$inferInsert)[];
  displayRuntimeStates: (typeof displayRuntimeStates.$inferInsert)[];
  displayGroups: (typeof displayGroups.$inferInsert)[];
  displayGroupMembers: (typeof displayGroupMembers.$inferInsert)[];
  content: (typeof content.$inferInsert)[];
  contentAssets: (typeof contentAssets.$inferInsert)[];
  contentTextContent: (typeof contentTextContent.$inferInsert)[];
  contentFlashMessages: (typeof contentFlashMessages.$inferInsert)[];
  playlists: (typeof playlists.$inferInsert)[];
  playlistItems: (typeof playlistItems.$inferInsert)[];
  schedules: (typeof schedules.$inferInsert)[];
  schedulePlaylistTargets: (typeof schedulePlaylistTargets.$inferInsert)[];
  scheduleContentTargets: (typeof scheduleContentTargets.$inferInsert)[];
  mediaUploads: MediaUpload[];
};

function assertSeedUuid(label: string, value: string | null | undefined): void {
  if (value != null && !isSeedUuid(value)) {
    throw new Error(`Invalid seeded UUID for ${label}: ${value}`);
  }
}

function validateSeedDataIds(seedData: SeedData): void {
  for (const display of seedData.displays) {
    assertSeedUuid("display.id", display.id);
  }
  for (const runtimeState of seedData.displayRuntimeStates) {
    assertSeedUuid("display_runtime_state.displayId", runtimeState.displayId);
  }
  for (const group of seedData.displayGroups) {
    assertSeedUuid("display_group.id", group.id);
  }
  for (const member of seedData.displayGroupMembers) {
    assertSeedUuid("display_group_member.groupId", member.groupId);
    assertSeedUuid("display_group_member.displayId", member.displayId);
  }
  for (const item of seedData.content) {
    assertSeedUuid("content.id", item.id);
    assertSeedUuid("content.ownerId", item.ownerId);
  }
  for (const asset of seedData.contentAssets) {
    assertSeedUuid("content_asset.contentId", asset.contentId);
  }
  for (const textContent of seedData.contentTextContent) {
    assertSeedUuid("content_text_content.contentId", textContent.contentId);
  }
  for (const flashMessage of seedData.contentFlashMessages) {
    assertSeedUuid("content_flash_message.contentId", flashMessage.contentId);
  }
  for (const playlist of seedData.playlists) {
    assertSeedUuid("playlist.id", playlist.id);
    assertSeedUuid("playlist.ownerId", playlist.ownerId);
  }
  for (const item of seedData.playlistItems) {
    assertSeedUuid("playlist_item.id", item.id);
    assertSeedUuid("playlist_item.playlistId", item.playlistId);
    assertSeedUuid("playlist_item.contentId", item.contentId);
  }
  for (const schedule of seedData.schedules) {
    assertSeedUuid("schedule.id", schedule.id);
    assertSeedUuid("schedule.displayId", schedule.displayId);
    assertSeedUuid("schedule.createdBy", schedule.createdBy);
  }
  for (const target of seedData.schedulePlaylistTargets) {
    assertSeedUuid("schedule_playlist_target.scheduleId", target.scheduleId);
    assertSeedUuid("schedule_playlist_target.playlistId", target.playlistId);
  }
  for (const target of seedData.scheduleContentTargets) {
    assertSeedUuid("schedule_content_target.scheduleId", target.scheduleId);
    assertSeedUuid("schedule_content_target.contentId", target.contentId);
  }
}

function buildSeedData(
  ownerId: string,
  now: Date,
  mediaAssets: {
    image: Uint8Array;
    video: Uint8Array;
  },
): SeedData {
  const displayRows: SeedData["displays"] = [];
  const runtimeRows: SeedData["displayRuntimeStates"] = [];
  const displayGroupRows: SeedData["displayGroups"] = [];
  const displayGroupMemberRows: SeedData["displayGroupMembers"] = [];
  const contentRows: SeedData["content"] = [];
  const contentAssetRows: SeedData["contentAssets"] = [];
  const textContentRows: SeedData["contentTextContent"] = [];
  const flashMessageRows: SeedData["contentFlashMessages"] = [];
  const playlistRows: SeedData["playlists"] = [];
  const playlistItemRows: SeedData["playlistItems"] = [];
  const scheduleRows: SeedData["schedules"] = [];
  const schedulePlaylistTargetRows: SeedData["schedulePlaylistTargets"] = [];
  const scheduleContentTargetRows: SeedData["scheduleContentTargets"] = [];
  const mediaUploads: MediaUpload[] = [];
  const playableContentIds: string[] = [];
  const imageChecksum = checksum(
    Buffer.from(mediaAssets.image).toString("base64"),
  );
  const videoChecksum = checksum(
    Buffer.from(mediaAssets.video).toString("base64"),
  );
  const videoThumbnailKey = "seed/ui-load/thumbnails/video-placeholder.png";

  mediaUploads.push({
    key: videoThumbnailKey,
    body: mediaAssets.image,
    contentType: "image/png",
  });

  for (let index = 1; index <= DISPLAY_COUNT; index += 1) {
    const displayNumber = pad(index);
    const displayId = deterministicUuid(`ui-load:display:${index}`);
    const status = cyclicValue(DISPLAY_STATUSES, index - 1);

    displayRows.push({
      id: displayId,
      slug: `ui-load-display-${displayNumber}`,
      name: `UI Load Display ${displayNumber}`,
      fingerprint: `ui-load-display-${displayNumber}`,
      output: cyclicValue(DISPLAY_OUTPUTS, index - 1),
      createdAt: now,
      updatedAt: now,
    });

    runtimeRows.push({
      displayId,
      status,
      lastSeenAt: status === "DOWN" ? null : addDays(now, -((index - 1) % 5)),
      refreshNonce: index % 9,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (let index = 1; index <= DISPLAY_COUNT / 10; index += 1) {
    const groupId = deterministicUuid(`ui-load:display-group:${index}`);
    displayGroupRows.push({
      id: groupId,
      name: `UI Load Zone ${pad(index, 2)}`,
      createdAt: now,
      updatedAt: now,
    });

    const startDisplay = (index - 1) * 10 + 1;
    for (
      let displayIndex = startDisplay;
      displayIndex < startDisplay + 10;
      displayIndex += 1
    ) {
      displayGroupMemberRows.push({
        groupId,
        displayId: deterministicUuid(`ui-load:display:${displayIndex}`),
      });
    }
  }

  for (let index = 1; index <= TEXT_CONTENT_COUNT; index += 1) {
    const contentNumber = pad(index);
    const contentId = deterministicUuid(`ui-load:text-content:${index}`);
    const text = `Load test text content ${contentNumber} for reviewing cards, playlists, and schedules.`;
    const htmlContent = `<p>${text}</p>`;
    const jsonContent = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    });

    contentRows.push({
      id: contentId,
      title: `UI Load Text Content ${contentNumber}`,
      type: "TEXT",
      status: "READY",
      ownerId,
      createdAt: addDays(now, -(index % 30)),
      updatedAt: addDays(now, -(index % 14)),
    });

    contentAssetRows.push({
      contentId,
      fileKey: `seed/ui-load/text/${contentNumber}.html`,
      thumbnailKey: null,
      checksum: checksum(htmlContent),
      mimeType: "text/html",
      fileSize: Buffer.byteLength(htmlContent, "utf8"),
      width: null,
      height: null,
      duration: null,
      createdAt: now,
      updatedAt: now,
    });

    textContentRows.push({
      contentId,
      jsonContent,
      htmlContent,
      createdAt: now,
      updatedAt: now,
    });
    playableContentIds.push(contentId);
  }

  for (let index = 1; index <= IMAGE_CONTENT_COUNT; index += 1) {
    const contentNumber = pad(index);
    const contentId = deterministicUuid(`ui-load:image-content:${index}`);
    const fileKey = `seed/ui-load/images/${contentNumber}.png`;

    contentRows.push({
      id: contentId,
      title: `UI Load Image Content ${contentNumber}`,
      type: "IMAGE",
      status: "READY",
      ownerId,
      createdAt: addDays(now, -(index % 30)),
      updatedAt: addDays(now, -(index % 14)),
    });

    contentAssetRows.push({
      contentId,
      fileKey,
      thumbnailKey: fileKey,
      checksum: imageChecksum,
      mimeType: "image/png",
      fileSize: mediaAssets.image.byteLength,
      width: MEDIA_WIDTH,
      height: MEDIA_HEIGHT,
      duration: null,
      createdAt: now,
      updatedAt: now,
    });

    mediaUploads.push({
      key: fileKey,
      body: mediaAssets.image,
      contentType: "image/png",
    });
    playableContentIds.push(contentId);
  }

  for (let index = 1; index <= VIDEO_CONTENT_COUNT; index += 1) {
    const contentNumber = pad(index);
    const contentId = deterministicUuid(`ui-load:video-content:${index}`);
    const fileKey = `seed/ui-load/videos/${contentNumber}.mp4`;

    contentRows.push({
      id: contentId,
      title: `UI Load Video Content ${contentNumber}`,
      type: "VIDEO",
      status: "READY",
      ownerId,
      createdAt: addDays(now, -(index % 30)),
      updatedAt: addDays(now, -(index % 14)),
    });

    contentAssetRows.push({
      contentId,
      fileKey,
      thumbnailKey: videoThumbnailKey,
      checksum: videoChecksum,
      mimeType: "video/mp4",
      fileSize: mediaAssets.video.byteLength,
      width: MEDIA_WIDTH,
      height: MEDIA_HEIGHT,
      duration: VIDEO_DURATION_SECONDS,
      createdAt: now,
      updatedAt: now,
    });

    mediaUploads.push({
      key: fileKey,
      body: mediaAssets.video,
      contentType: "video/mp4",
    });
    playableContentIds.push(contentId);
  }

  for (let index = 1; index <= FLASH_CONTENT_COUNT; index += 1) {
    const contentNumber = pad(index);
    const contentId = deterministicUuid(`ui-load:flash-content:${index}`);
    const message = `Flash notice ${contentNumber}: rotating campus message for display testing.`;

    contentRows.push({
      id: contentId,
      title: `UI Load Flash Content ${contentNumber}`,
      type: "FLASH",
      status: "READY",
      ownerId,
      createdAt: addDays(now, -(index % 30)),
      updatedAt: addDays(now, -(index % 14)),
    });

    contentAssetRows.push({
      contentId,
      fileKey: `seed/ui-load/flash/${contentNumber}.txt`,
      thumbnailKey: null,
      checksum: checksum(message),
      mimeType: "text/plain",
      fileSize: Buffer.byteLength(message, "utf8"),
      width: null,
      height: null,
      duration: 10,
      createdAt: now,
      updatedAt: now,
    });

    flashMessageRows.push({
      contentId,
      message,
      tone: cyclicValue(FLASH_TONES, index - 1),
      createdAt: now,
      updatedAt: now,
    });
  }

  for (let index = 1; index <= PLAYLIST_COUNT; index += 1) {
    const playlistNumber = pad(index);
    const playlistId = deterministicUuid(`ui-load:playlist:${index}`);

    playlistRows.push({
      id: playlistId,
      name: `UI Load Playlist ${playlistNumber}`,
      description: "Five-item load-test playlist for admin UI review.",
      status: index <= 80 ? "IN_USE" : "DRAFT",
      ownerId,
      showCounter: index % 2 === 0,
      createdAt: addDays(now, -(index % 20)),
      updatedAt: addDays(now, -(index % 10)),
    });

    for (
      let itemIndex = 1;
      itemIndex <= PLAYLIST_ITEMS_PER_PLAYLIST;
      itemIndex += 1
    ) {
      const playableContentIndex =
        ((index - 1) * PLAYLIST_ITEMS_PER_PLAYLIST + itemIndex - 1) %
        playableContentIds.length;
      const contentId = playableContentIds[playableContentIndex];
      if (!contentId) {
        throw new Error("Unable to resolve playlist content for seed data");
      }

      playlistItemRows.push({
        id: deterministicUuid(`ui-load:playlist-item:${index}:${itemIndex}`),
        playlistId,
        contentId,
        sequence: itemIndex * 10,
        duration: 5 + itemIndex * 5,
        loop: itemIndex === PLAYLIST_ITEMS_PER_PLAYLIST,
      });
    }
  }

  const startDate = toZonedDateKey(now, env.SCHEDULE_TIMEZONE);
  const endDate = toZonedDateKey(addDays(now, 6), env.SCHEDULE_TIMEZONE);
  const scheduleWindows = scheduleWindowsFromNow(now, env.SCHEDULE_TIMEZONE);

  for (let displayIndex = 1; displayIndex <= DISPLAY_COUNT; displayIndex += 1) {
    for (let slotIndex = 0; slotIndex < SCHEDULES_PER_DISPLAY; slotIndex += 1) {
      const scheduleIndex =
        (displayIndex - 1) * SCHEDULES_PER_DISPLAY + slotIndex + 1;
      const scheduleNumber = pad(scheduleIndex);
      const scheduleId = deterministicUuid(`ui-load:schedule:${scheduleIndex}`);
      const window = cyclicValue(scheduleWindows, slotIndex);
      const isPlaylistSchedule = window.kind === "PLAYLIST";

      scheduleRows.push({
        id: scheduleId,
        name: `UI Load Schedule ${scheduleNumber}`,
        displayId: deterministicUuid(`ui-load:display:${displayIndex}`),
        startDate,
        endDate,
        startTime: window.startTime,
        endTime: window.endTime,
        createdBy: ownerId,
        createdAt: new Date(now.getTime() + scheduleIndex),
        updatedAt: now,
      });

      if (isPlaylistSchedule) {
        const playlistIndex = ((scheduleIndex - 1) % 80) + 1;
        schedulePlaylistTargetRows.push({
          scheduleId,
          playlistId: deterministicUuid(`ui-load:playlist:${playlistIndex}`),
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const flashIndex = ((scheduleIndex - 1) % FLASH_CONTENT_COUNT) + 1;
        scheduleContentTargetRows.push({
          scheduleId,
          contentId: deterministicUuid(`ui-load:flash-content:${flashIndex}`),
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  return {
    displays: displayRows,
    displayRuntimeStates: runtimeRows,
    displayGroups: displayGroupRows,
    displayGroupMembers: displayGroupMemberRows,
    content: contentRows,
    contentAssets: contentAssetRows,
    contentTextContent: textContentRows,
    contentFlashMessages: flashMessageRows,
    playlists: playlistRows,
    playlistItems: playlistItemRows,
    schedules: scheduleRows,
    schedulePlaylistTargets: schedulePlaylistTargetRows,
    scheduleContentTargets: scheduleContentTargetRows,
    mediaUploads,
  };
}

async function insertSeedData(seedData: SeedData): Promise<void> {
  await db.transaction(async (tx) => {
    await insertChunks(seedData.displays, (chunk) =>
      tx.insert(displays).values(chunk),
    );
    await insertChunks(seedData.displayRuntimeStates, (chunk) =>
      tx.insert(displayRuntimeStates).values(chunk),
    );
    await insertChunks(seedData.displayGroups, (chunk) =>
      tx.insert(displayGroups).values(chunk),
    );
    await insertChunks(seedData.displayGroupMembers, (chunk) =>
      tx.insert(displayGroupMembers).values(chunk),
    );
    await insertChunks(seedData.content, (chunk) =>
      tx.insert(content).values(chunk),
    );
    await insertChunks(seedData.contentAssets, (chunk) =>
      tx.insert(contentAssets).values(chunk),
    );
    await insertChunks(seedData.contentTextContent, (chunk) =>
      tx.insert(contentTextContent).values(chunk),
    );
    await insertChunks(seedData.contentFlashMessages, (chunk) =>
      tx.insert(contentFlashMessages).values(chunk),
    );
    await insertChunks(seedData.playlists, (chunk) =>
      tx.insert(playlists).values(chunk),
    );
    await insertChunks(seedData.playlistItems, (chunk) =>
      tx.insert(playlistItems).values(chunk),
    );
    await insertChunks(seedData.schedules, (chunk) =>
      tx.insert(schedules).values(chunk),
    );
    await insertChunks(seedData.schedulePlaylistTargets, (chunk) =>
      tx.insert(schedulePlaylistTargets).values(chunk),
    );
    await insertChunks(seedData.scheduleContentTargets, (chunk) =>
      tx.insert(scheduleContentTargets).values(chunk),
    );
  });
}

async function main(): Promise<void> {
  const now = new Date();
  const mediaAssets = await generateSeedMediaAssets();
  const owner = await findSeedOwner();
  const seedData = buildSeedData(owner.id, now, mediaAssets);
  validateSeedDataIds(seedData);

  console.log(`Using owner: ${owner.username} (${owner.id})`);
  console.log(`Uploading ${seedData.mediaUploads.length} seed media assets...`);
  await uploadMediaAssets(seedData.mediaUploads);

  console.log("Resetting display/content/playlist/schedule data...");
  await resetUiLoadDomains(now);

  console.log("Seeding UI load dataset...");
  await insertSeedData(seedData);

  console.log("Done. Seeded UI load dataset:");
  console.log(`- ${seedData.displays.length} displays`);
  console.log(`- ${seedData.displayGroups.length} display groups`);
  console.log(`- ${NON_FLASH_CONTENT_COUNT} non-flash content items`);
  console.log(`- ${TEXT_CONTENT_COUNT} text content items`);
  console.log(`- ${IMAGE_CONTENT_COUNT} image content items`);
  console.log(`- ${VIDEO_CONTENT_COUNT} video content items`);
  console.log(`- ${FLASH_CONTENT_COUNT} flash content items`);
  console.log(`- ${seedData.playlists.length} playlists`);
  console.log(`- ${seedData.playlistItems.length} playlist items`);
  console.log(`- ${seedData.schedules.length} schedules`);
  console.log(
    `- ${seedData.schedulePlaylistTargets.length} playlist schedule targets`,
  );
  console.log(
    `- ${seedData.scheduleContentTargets.length} flash schedule targets`,
  );
}

if (import.meta.main) {
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    exitCode = 1;
    console.error(error instanceof Error ? error.message : error);
  } finally {
    await closeDbConnection();
  }

  process.exit(exitCode);
}
