import {
  type ContentRepository,
  type ContentStorage,
  type ContentThumbnailGenerator,
} from "#/application/ports/content";
import {
  type PdfCropRenderer,
  type PdfCropSessionStore,
} from "#/application/ports/pdf-crop";
import { type UserRepository } from "#/application/ports/rbac";
import { sha256Hex } from "#/domain/content/checksum";
import {
  buildContentFileKey,
  buildContentThumbnailKey,
} from "#/domain/content/content";
import { toContentView } from "./content-view";
import { NotFoundError } from "./errors";

export interface CropRegion {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class SubmitPdfCropUseCase {
  constructor(
    private readonly deps: {
      contentStorage: ContentStorage;
      contentRepository: ContentRepository;
      pdfCropSessionStore: PdfCropSessionStore;
      pdfCropRenderer: PdfCropRenderer;
      contentThumbnailGenerator: ContentThumbnailGenerator;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    uploadId: string;
    crops: CropRegion[];
    ownerId: string;
  }) {
    const user = await this.deps.userRepository.findById(input.ownerId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const session = await this.deps.pdfCropSessionStore.findById(
      input.uploadId,
    );
    if (!session || session.ownerId !== input.ownerId) {
      throw new NotFoundError("PDF crop session not found");
    }

    const pdfData = await this.deps.contentStorage.download?.(
      session.tempFileKey,
    );
    if (!pdfData) {
      throw new NotFoundError("PDF temp file not found");
    }

    const contentItems = [];
    let cropIndex = 0;

    for (const crop of input.crops) {
      cropIndex += 1;
      const title = `${session.filename} - Page ${crop.pageNumber} Crop ${cropIndex}`;

      const croppedPng = await this.deps.pdfCropRenderer.renderCrop({
        pdfData,
        pageNumber: crop.pageNumber,
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
      });

      const id = crypto.randomUUID();
      const fileKey = buildContentFileKey({
        id,
        type: "IMAGE",
        mimeType: "image/png",
      });
      const checksum = await sha256Hex(croppedPng.buffer as ArrayBuffer);

      const thumbnailData = await this.deps.contentThumbnailGenerator
        .generate({
          type: "IMAGE",
          mimeType: "image/png",
          data: croppedPng,
        })
        .catch(() => null);

      let thumbnailKey: string | null = null;
      if (thumbnailData) {
        thumbnailKey = buildContentThumbnailKey(id);
        await this.deps.contentStorage
          .upload({
            key: thumbnailKey,
            body: thumbnailData,
            contentType: "image/jpeg",
            contentLength: thumbnailData.byteLength,
          })
          .catch(() => {
            thumbnailKey = null;
          });
      }

      await this.deps.contentStorage.upload({
        key: fileKey,
        body: croppedPng,
        contentType: "image/png",
        contentLength: croppedPng.byteLength,
      });

      const record = await this.deps.contentRepository.create({
        id,
        title,
        type: "IMAGE",
        status: "READY",
        fileKey,
        thumbnailKey,
        checksum,
        mimeType: "image/png",
        fileSize: croppedPng.byteLength,
        width: crop.width,
        height: crop.height,
        duration: null,
        ownerId: user.id,
      });

      contentItems.push(toContentView(record, user.name));
    }

    await this.deps.contentStorage
      .delete(session.tempFileKey)
      .catch(() => undefined);
    await this.deps.pdfCropSessionStore.delete(input.uploadId);

    return { items: contentItems };
  }
}
