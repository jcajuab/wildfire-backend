import { type ContentStorage } from "#/application/ports/content";
import { type PdfCropSessionStore } from "#/application/ports/pdf-crop";
import { NotFoundError } from "./errors";

export class CancelPdfCropUseCase {
  constructor(
    private readonly deps: {
      contentStorage: ContentStorage;
      pdfCropSessionStore: PdfCropSessionStore;
    },
  ) {}

  async execute(input: { uploadId: string; ownerId: string }) {
    const session = await this.deps.pdfCropSessionStore.findById(
      input.uploadId,
    );
    if (!session || session.ownerId !== input.ownerId) {
      throw new NotFoundError("PDF crop session not found");
    }

    await this.deps.contentStorage
      .delete(session.tempFileKey)
      .catch(() => undefined);
    await this.deps.pdfCropSessionStore.delete(input.uploadId);
  }
}
