import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ffprobeStatic from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import { imageSize } from "image-size";
import {
  type ContentMetadataExtractor,
  type ExtractedContentMetadata,
} from "#/application/ports/content";
import { type ContentType } from "#/domain/content/content";

ffmpeg.setFfprobePath(ffprobeStatic.path);

const toPositiveInt = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label} metadata`);
  }
  return Math.max(1, Math.round(value));
};

const inspectVideo = async (
  data: Uint8Array,
): Promise<ExtractedContentMetadata> => {
  const tempPath = join("/tmp", `wildfire-video-${randomUUID()}.bin`);
  await writeFile(tempPath, data);
  try {
    const probe = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
      ffmpeg.ffprobe(tempPath, (error, metadata) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(metadata);
      });
    });
    const videoStream = probe.streams.find(
      (stream) =>
        stream.codec_type === "video" &&
        typeof stream.width === "number" &&
        typeof stream.height === "number",
    );
    const durationSeconds =
      typeof probe.format.duration === "number"
        ? probe.format.duration
        : typeof videoStream?.duration === "number"
          ? videoStream.duration
          : null;
    if (!videoStream || durationSeconds === null) {
      throw new Error("Unable to read video metadata");
    }
    const width = videoStream.width;
    const height = videoStream.height;
    if (typeof width !== "number" || typeof height !== "number") {
      throw new Error("Unable to read video dimensions");
    }
    return {
      width: toPositiveInt(width, "video width"),
      height: toPositiveInt(height, "video height"),
      duration: toPositiveInt(durationSeconds, "video duration"),
    };
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
};

export class DefaultContentMetadataExtractor
  implements ContentMetadataExtractor
{
  async extract(input: {
    type: ContentType;
    mimeType: string;
    data: Uint8Array;
  }): Promise<ExtractedContentMetadata> {
    if (input.type === "IMAGE") {
      const dimensions = imageSize(input.data);
      if (
        typeof dimensions.width !== "number" ||
        typeof dimensions.height !== "number"
      ) {
        throw new Error("Unable to read image dimensions");
      }
      return {
        width: toPositiveInt(dimensions.width, "image width"),
        height: toPositiveInt(dimensions.height, "image height"),
        duration: null,
      };
    }

    return inspectVideo(input.data);
  }
}
