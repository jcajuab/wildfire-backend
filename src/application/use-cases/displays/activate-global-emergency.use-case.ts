import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";
import { isRenderableEmergencyAsset } from "./shared";

const pickDisplayEmergencyAssetId = (input: {
  display: { emergencyContentId?: string | null };
  defaultEmergencyContentId?: string;
}): string | null =>
  input.display.emergencyContentId ?? input.defaultEmergencyContentId ?? null;

export class ActivateGlobalEmergencyUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      contentRepository: ContentRepository;
      runtimeControlRepository: RuntimeControlRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
      defaultEmergencyContentId?: string;
    },
  ) {}

  async execute(input: { reason?: string }): Promise<void> {
    const now = new Date();
    const displays = await this.deps.displayRepository.list();
    if (displays.length === 0) {
      await this.deps.runtimeControlRepository.setGlobalEmergencyState({
        active: true,
        startedAt: now,
        at: now,
      });
      return;
    }

    const assetIds = Array.from(
      new Set(
        displays
          .map((display) =>
            pickDisplayEmergencyAssetId({
              display,
              defaultEmergencyContentId: this.deps.defaultEmergencyContentId,
            }),
          )
          .filter((value): value is string => value != null),
      ),
    );

    const assets = await this.deps.contentRepository.findByIds(assetIds);
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

    const missingDisplay = displays.find((display) => {
      const selectedAssetId = pickDisplayEmergencyAssetId({
        display,
        defaultEmergencyContentId: this.deps.defaultEmergencyContentId,
      });
      if (!selectedAssetId) {
        return true;
      }
      const asset = assetsById.get(selectedAssetId);
      return !asset || !isRenderableEmergencyAsset(asset);
    });

    if (missingDisplay) {
      throw new ValidationError(
        `Display ${missingDisplay.slug} has no valid emergency content asset`,
      );
    }

    await this.deps.runtimeControlRepository.setGlobalEmergencyState({
      active: true,
      startedAt: now,
      at: now,
    });

    for (const display of displays) {
      this.deps.displayEventPublisher?.publish({
        type: "manifest_updated",
        displayId: display.id,
        reason: input.reason ?? "global_emergency_activated",
        timestamp: now.toISOString(),
      });
    }
  }
}
