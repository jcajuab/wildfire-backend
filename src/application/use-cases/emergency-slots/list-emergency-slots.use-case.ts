import {
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type EmergencySlotRecord,
  type EmergencySlotRepository,
} from "#/application/ports/emergency-slots";
import { getTextPreviewText } from "#/application/use-cases/content/content-view";

export const EMERGENCY_SLOT_COUNT = 5;

export interface EmergencySlotView {
  slotIndex: number;
  contentId: string | null;
  content: {
    id: string;
    title: string;
    type: ContentRecord["type"];
    status: ContentRecord["status"];
    thumbnailKey: string | null;
    thumbnailUrl: string | null;
    textPreviewText: string | null;
    textHtmlContent: string | null;
  } | null;
  updatedAt: string | null;
}

export class ListEmergencySlotsUseCase {
  constructor(
    private readonly deps: {
      emergencySlotRepository: EmergencySlotRepository;
      contentRepository: ContentRepository;
      contentStorage?: ContentStorage;
      thumbnailUrlExpiresInSeconds?: number;
    },
  ) {}

  private async buildThumbnailUrlMap(
    records: readonly ContentRecord[],
  ): Promise<Map<string, string>> {
    if (!this.deps.contentStorage) {
      return new Map();
    }

    const thumbnailKeys = Array.from(
      new Set(
        records
          .map((record) => record.thumbnailKey)
          .filter(
            (key): key is string => typeof key === "string" && key.length > 0,
          ),
      ),
    );

    const thumbnailUrlByKey = new Map<string, string>();
    await Promise.all(
      thumbnailKeys.map(async (thumbnailKey) => {
        try {
          const thumbnailUrl =
            await this.deps.contentStorage?.getPresignedDownloadUrl({
              key: thumbnailKey,
              expiresInSeconds: this.deps.thumbnailUrlExpiresInSeconds ?? 3600,
            });
          if (thumbnailUrl) {
            thumbnailUrlByKey.set(thumbnailKey, thumbnailUrl);
          }
        } catch {
          // Best-effort enrichment only.
        }
      }),
    );

    return thumbnailUrlByKey;
  }

  async execute(): Promise<EmergencySlotView[]> {
    const slots = await this.deps.emergencySlotRepository.list();
    const slotsByIndex = new Map<number, EmergencySlotRecord>(
      slots.map((slot) => [slot.slotIndex, slot]),
    );

    const contentIds = slots
      .map((slot) => slot.contentId)
      .filter((value): value is string => value != null);
    const contents =
      contentIds.length > 0
        ? await this.deps.contentRepository.findByIds(contentIds)
        : [];
    const contentsById = new Map(contents.map((c) => [c.id, c]));
    const thumbnailUrlByKey = await this.buildThumbnailUrlMap(contents);

    const result: EmergencySlotView[] = [];
    for (let i = 1; i <= EMERGENCY_SLOT_COUNT; i += 1) {
      const slot = slotsByIndex.get(i);
      if (!slot) {
        result.push({
          slotIndex: i,
          contentId: null,
          content: null,
          updatedAt: null,
        });
        continue;
      }
      const content = slot.contentId
        ? (contentsById.get(slot.contentId) ?? null)
        : null;
      result.push({
        slotIndex: i,
        contentId: slot.contentId,
        content: content
          ? {
              id: content.id,
              title: content.title,
              type: content.type,
              status: content.status,
              thumbnailKey: content.thumbnailKey ?? null,
              thumbnailUrl: content.thumbnailKey
                ? (thumbnailUrlByKey.get(content.thumbnailKey) ?? null)
                : null,
              textPreviewText:
                content.type === "TEXT"
                  ? getTextPreviewText(content.textHtmlContent)
                  : null,
              textHtmlContent:
                content.type === "TEXT"
                  ? (content.textHtmlContent ?? null)
                  : null,
            }
          : null,
        updatedAt: slot.updatedAt,
      });
    }
    return result;
  }
}
