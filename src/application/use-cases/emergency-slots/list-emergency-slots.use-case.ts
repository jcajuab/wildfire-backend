import {
  type ContentRecord,
  type ContentRepository,
} from "#/application/ports/content";
import {
  type EmergencySlotRecord,
  type EmergencySlotRepository,
} from "#/application/ports/emergency-slots";

export const EMERGENCY_SLOT_COUNT = 5;

export interface EmergencySlotView {
  slotIndex: number;
  label: string | null;
  contentId: string | null;
  content: {
    id: string;
    title: string;
    type: ContentRecord["type"];
    status: ContentRecord["status"];
    thumbnailKey: string | null;
  } | null;
  updatedAt: string | null;
}

export class ListEmergencySlotsUseCase {
  constructor(
    private readonly deps: {
      emergencySlotRepository: EmergencySlotRepository;
      contentRepository: ContentRepository;
    },
  ) {}

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

    const result: EmergencySlotView[] = [];
    for (let i = 1; i <= EMERGENCY_SLOT_COUNT; i += 1) {
      const slot = slotsByIndex.get(i);
      if (!slot) {
        result.push({
          slotIndex: i,
          label: null,
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
        label: slot.label,
        contentId: slot.contentId,
        content: content
          ? {
              id: content.id,
              title: content.title,
              type: content.type,
              status: content.status,
              thumbnailKey: content.thumbnailKey ?? null,
            }
          : null,
        updatedAt: slot.updatedAt,
      });
    }
    return result;
  }
}
