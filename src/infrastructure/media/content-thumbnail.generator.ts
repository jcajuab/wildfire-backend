import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { type ContentThumbnailGenerator } from "#/application/ports/content";
import {
  type ContentType,
  resolveFileExtension,
} from "#/domain/content/content";

type GenerateJpegInput = {
  type: ContentType;
  mimeType: string;
  data: Uint8Array;
  maxWidth: number;
  maxHeight: number;
  seekSeconds: number;
};

type GenerateJpegFn = (input: GenerateJpegInput) => Promise<Uint8Array | null>;

const buildScaleFilter = (maxWidth: number, maxHeight: number): string =>
  `scale=min(${maxWidth}\\,iw):min(${maxHeight}\\,ih):force_original_aspect_ratio=decrease`;

const runFfmpegToJpeg = async (input: {
  sourcePath: string;
  outputPath: string;
  maxWidth: number;
  maxHeight: number;
  seekSeconds: number;
}): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const outputOptions = [
      "-frames:v 1",
      "-vf",
      buildScaleFilter(input.maxWidth, input.maxHeight),
      "-q:v 3",
      "-y",
    ];

    let command = ffmpeg(input.sourcePath).outputOptions(outputOptions);
    if (input.seekSeconds > 0) {
      command = command.seekInput(input.seekSeconds);
    }

    command
      .on("end", () => resolve())
      .on("error", reject)
      .save(input.outputPath);
  });

const generateJpegWithFfmpeg: GenerateJpegFn = async (input) => {
  const extension = resolveFileExtension(input.mimeType);
  if (!extension) {
    return null;
  }

  const sourcePath = join(
    "/tmp",
    `wildfire-content-${randomUUID()}.${extension}`,
  );
  const outputPath = join("/tmp", `wildfire-thumb-${randomUUID()}.jpg`);

  await writeFile(sourcePath, input.data);
  try {
    await runFfmpegToJpeg({
      sourcePath,
      outputPath,
      maxWidth: input.maxWidth,
      maxHeight: input.maxHeight,
      seekSeconds: input.seekSeconds,
    });
    const output = await readFile(outputPath).catch(() => null);
    return output ? new Uint8Array(output) : null;
  } catch {
    return null;
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
  }
};

const defaultsByType: Record<
  ContentType,
  Pick<GenerateJpegInput, "maxWidth" | "maxHeight" | "seekSeconds">
> = {
  IMAGE: { maxWidth: 400, maxHeight: 300, seekSeconds: 0 },
  PDF: { maxWidth: 400, maxHeight: 300, seekSeconds: 0 },
  VIDEO: { maxWidth: 400, maxHeight: 300, seekSeconds: 1 },
};

export class DefaultContentThumbnailGenerator
  implements ContentThumbnailGenerator
{
  private readonly generateJpeg: GenerateJpegFn;

  constructor(deps?: { generateJpeg?: GenerateJpegFn }) {
    this.generateJpeg = deps?.generateJpeg ?? generateJpegWithFfmpeg;
  }

  async generate(input: {
    type: ContentType;
    mimeType: string;
    data: Uint8Array;
  }): Promise<Uint8Array | null> {
    const defaults = defaultsByType[input.type];
    return this.generateJpeg({
      ...input,
      ...defaults,
    }).catch(() => null);
  }
}
