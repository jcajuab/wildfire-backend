import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import {
  type FlashActivationRecord,
  type FlashActivationRepository,
  type FlashTone,
} from "#/application/ports/flash-activations";
import { type UserRepository } from "#/application/ports/rbac";
import { sha256Hex } from "#/domain/content/checksum";
import { toContentView } from "./content-view";
import { FlashActivationConflictError, NotFoundError } from "./errors";

const MIN_FLASH_DURATION_SECONDS = 5;
const MAX_FLASH_DURATION_SECONDS = 600;

const toPendingConflict = (input: {
  message: string;
  targetDisplayId: string;
  durationSeconds: number;
  tone: FlashTone;
}) => ({
  message: input.message,
  targetDisplayId: input.targetDisplayId,
  durationSeconds: input.durationSeconds,
  tone: input.tone,
});

const normalizeMessage = (value: string): string => value.trim();

const createFlashTitle = (createdAt: Date): string =>
  `Flash ${createdAt.toISOString()}`;

const createFlashFileKey = (contentId: string): string =>
  `content/flash/${contentId}.txt`;

const buildFlashChecksum = async (input: {
  message: string;
  tone: FlashTone;
  targetDisplayId: string;
  durationSeconds: number;
}): Promise<string> => {
  const payload = JSON.stringify({
    message: input.message,
    tone: input.tone,
    targetDisplayId: input.targetDisplayId,
    durationSeconds: input.durationSeconds,
  });
  const bytes = new TextEncoder().encode(payload);
  return sha256Hex(bytes.buffer);
};

const publishManifestUpdate = (
  publisher: DisplayStreamEventPublisher | undefined,
  input: {
    displayId: string;
    reason: string;
    at: Date;
  },
): void => {
  publisher?.publish({
    type: "manifest_updated",
    displayId: input.displayId,
    reason: input.reason,
    timestamp: input.at.toISOString(),
  });
};

export class CreateFlashActivationUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      displayRepository: DisplayRepository;
      flashActivationRepository: FlashActivationRepository;
      userRepository: UserRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    message: string;
    targetDisplayId: string;
    durationSeconds: number;
    tone: FlashTone;
    createdById: string;
    conflictDecision?: "prompt" | "replace" | "keep";
    expectedActiveActivationId?: string;
    now?: Date;
  }): Promise<{
    content: ReturnType<typeof toContentView>;
    activation: FlashActivationRecord;
    replacedActivation?: FlashActivationRecord | null;
  }> {
    const now = input.now ?? new Date();
    const message = normalizeMessage(input.message);
    if (message.length === 0 || message.length > 240) {
      throw new ValidationError(
        "Flash message must be between 1 and 240 chars",
      );
    }
    if (
      !Number.isInteger(input.durationSeconds) ||
      input.durationSeconds < MIN_FLASH_DURATION_SECONDS ||
      input.durationSeconds > MAX_FLASH_DURATION_SECONDS
    ) {
      throw new ValidationError(
        `Flash durationSeconds must be between ${MIN_FLASH_DURATION_SECONDS} and ${MAX_FLASH_DURATION_SECONDS}`,
      );
    }

    const display = await this.deps.displayRepository.findById(
      input.targetDisplayId,
    );
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    const active = await this.deps.flashActivationRepository.findActive(now);
    const pendingConflict = toPendingConflict({
      message,
      targetDisplayId: input.targetDisplayId,
      durationSeconds: input.durationSeconds,
      tone: input.tone,
    });

    if (active) {
      const expected = input.expectedActiveActivationId;
      if (expected && expected !== active.id) {
        throw new FlashActivationConflictError(
          "Flash content changed while you were confirming",
          {
            active,
            pending: pendingConflict,
          },
        );
      }

      if (input.conflictDecision !== "replace") {
        throw new FlashActivationConflictError(
          "A flash content item is already active",
          {
            active,
            pending: pendingConflict,
          },
        );
      }
    }

    const contentId = crypto.randomUUID();
    const checksum = await buildFlashChecksum({
      message,
      tone: input.tone,
      targetDisplayId: input.targetDisplayId,
      durationSeconds: input.durationSeconds,
    });
    const messageSize = new TextEncoder().encode(message).byteLength;

    await this.deps.contentRepository.create({
      id: contentId,
      title: createFlashTitle(now),
      type: "FLASH",
      kind: "ROOT",
      status: "READY",
      fileKey: createFlashFileKey(contentId),
      thumbnailKey: null,
      parentContentId: null,
      pageNumber: null,
      pageCount: null,
      isExcluded: false,
      checksum,
      mimeType: "text/plain",
      fileSize: messageSize,
      width: null,
      height: null,
      duration: null,
      flashMessage: message,
      flashTone: input.tone,
      createdById: input.createdById,
    });

    const createdContent =
      await this.deps.contentRepository.findById(contentId);
    if (!createdContent) {
      throw new Error("Flash content was created but could not be loaded");
    }

    const startsAt = now;
    const endsAt = new Date(now.getTime() + input.durationSeconds * 1000);
    let activation: FlashActivationRecord;
    let replacedActivation: FlashActivationRecord | null = null;

    if (active) {
      const replaced =
        await this.deps.flashActivationRepository.createReplacingActive({
          replacementOfId: active.id,
          replacementStoppedAt: startsAt,
          replacementReason: "replaced",
          id: crypto.randomUUID(),
          contentId,
          targetDisplayId: input.targetDisplayId,
          message,
          tone: input.tone,
          startedAt: startsAt,
          endsAt,
          createdById: input.createdById,
        });
      activation = replaced.created;
      replacedActivation = replaced.stopped;
    } else {
      activation = await this.deps.flashActivationRepository.create({
        id: crypto.randomUUID(),
        contentId,
        targetDisplayId: input.targetDisplayId,
        message,
        tone: input.tone,
        startedAt: startsAt,
        endsAt,
        createdById: input.createdById,
      });
    }

    publishManifestUpdate(this.deps.displayEventPublisher, {
      displayId: input.targetDisplayId,
      reason: "flash_activated",
      at: now,
    });
    if (
      replacedActivation &&
      replacedActivation.targetDisplayId !== input.targetDisplayId
    ) {
      publishManifestUpdate(this.deps.displayEventPublisher, {
        displayId: replacedActivation.targetDisplayId,
        reason: "flash_replaced",
        at: now,
      });
    }

    const creator = await this.deps.userRepository.findById(
      createdContent.createdById,
    );
    return {
      content: toContentView(createdContent, creator?.name ?? null),
      activation,
      replacedActivation,
    };
  }
}

export class GetActiveFlashActivationUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      flashActivationRepository: FlashActivationRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { now: Date }): Promise<{
    content: ReturnType<typeof toContentView>;
    activation: FlashActivationRecord;
  } | null> {
    const active = await this.deps.flashActivationRepository.findActive(
      input.now,
    );
    if (!active) {
      return null;
    }

    const content = await this.deps.contentRepository.findById(
      active.contentId,
    );
    if (!content) {
      throw new NotFoundError("Flash content not found");
    }
    const creator = await this.deps.userRepository.findById(
      content.createdById,
    );

    return {
      content: toContentView(content, creator?.name ?? null),
      activation: active,
    };
  }
}

export class StopFlashActivationUseCase {
  constructor(
    private readonly deps: {
      flashActivationRepository: FlashActivationRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    activationId?: string;
    reason?: string;
    now?: Date;
  }): Promise<FlashActivationRecord | null> {
    const now = input.now ?? new Date();
    const reason = input.reason?.trim() || "stopped";
    const stopped = input.activationId
      ? await this.deps.flashActivationRepository.stopById({
          id: input.activationId,
          stoppedAt: now,
          reason,
          status: "STOPPED",
        })
      : await this.deps.flashActivationRepository.stopActive({
          stoppedAt: now,
          reason,
          status: "STOPPED",
        });

    if (!stopped || stopped.status === "EXPIRED") {
      return stopped;
    }

    publishManifestUpdate(this.deps.displayEventPublisher, {
      displayId: stopped.targetDisplayId,
      reason: "flash_stopped",
      at: now,
    });
    return stopped;
  }
}
