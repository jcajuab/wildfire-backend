import { type ContentStorage } from "#/application/ports/content";
import {
  type PdfCropSessionStore,
  type PdfPageExtractor,
} from "#/application/ports/pdf-crop";
import { type UserRepository } from "#/application/ports/rbac";
import { NotFoundError } from "./errors";

export class InitPdfCropUseCase {
  constructor(
    private readonly deps: {
      contentStorage: ContentStorage;
      pdfCropSessionStore: PdfCropSessionStore;
      pdfPageExtractor: PdfPageExtractor;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    file: File;
    ownerId: string;
    downloadUrlExpiresInSeconds?: number;
  }) {
    const user = await this.deps.userRepository.findById(input.ownerId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (input.file.type !== "application/pdf") {
      throw new Error("Only PDF files are supported");
    }

    const buffer = await input.file.arrayBuffer();
    const pdfData = new Uint8Array(buffer);

    const { pageCount, pages } =
      await this.deps.pdfPageExtractor.extract(pdfData);

    const uploadId = crypto.randomUUID();
    const tempFileKey = `content/pdf-temp/${uploadId}.pdf`;

    await this.deps.contentStorage.upload({
      key: tempFileKey,
      body: pdfData,
      contentType: "application/pdf",
      contentLength: pdfData.byteLength,
    });

    const filename = input.file.name.replace(/\.pdf$/i, "");

    const session = {
      uploadId,
      ownerId: user.id,
      filename,
      tempFileKey,
      pageCount,
      pages,
      createdAt: new Date().toISOString(),
    };

    await this.deps.pdfCropSessionStore.save(session);

    const pdfUrl = await this.deps.contentStorage.getPresignedDownloadUrl({
      key: tempFileKey,
      expiresInSeconds: input.downloadUrlExpiresInSeconds ?? 3600,
    });

    return { ...session, pdfUrl };
  }
}
