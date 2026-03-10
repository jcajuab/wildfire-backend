export type ContentType = "IMAGE" | "VIDEO" | "PDF" | "FLASH" | "TEXT";
export type MediaContentType = "IMAGE" | "VIDEO" | "PDF";
export type ContentStatus = "PROCESSING" | "READY" | "FAILED";
export type ContentKind = "ROOT" | "PAGE";

const imageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const videoMimeTypes = new Set(["video/mp4"]);
const documentMimeTypes = new Set(["application/pdf"]);

const mimeTypeToExtension = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["video/mp4", "mp4"],
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["application/json", "json"],
]);

export const isSupportedMimeType = (mimeType: string): boolean =>
  imageMimeTypes.has(mimeType) ||
  videoMimeTypes.has(mimeType) ||
  documentMimeTypes.has(mimeType);

export const resolveContentType = (
  mimeType: string,
): MediaContentType | null => {
  if (imageMimeTypes.has(mimeType)) return "IMAGE";
  if (videoMimeTypes.has(mimeType)) return "VIDEO";
  if (documentMimeTypes.has(mimeType)) return "PDF";
  return null;
};

export const parseContentType = (value: string): ContentType | null => {
  if (
    value === "IMAGE" ||
    value === "VIDEO" ||
    value === "PDF" ||
    value === "FLASH" ||
    value === "TEXT"
  ) {
    return value;
  }
  return null;
};

export const parseContentStatus = (value: string): ContentStatus | null => {
  if (value === "PROCESSING" || value === "READY" || value === "FAILED") {
    return value;
  }
  return null;
};

export const parseContentKind = (value: string): ContentKind | null => {
  if (value === "ROOT" || value === "PAGE") {
    return value;
  }
  return null;
};

export const resolveFileExtension = (mimeType: string): string | null =>
  mimeTypeToExtension.get(mimeType) ?? null;

export const buildContentFileKey = (input: {
  id: string;
  type: ContentType;
  mimeType: string;
}): string => {
  const extension = resolveFileExtension(input.mimeType);
  if (!extension) {
    throw new Error(`Unsupported mime type: ${input.mimeType}`);
  }

  const directory =
    input.type === "IMAGE"
      ? "images"
      : input.type === "VIDEO"
        ? "videos"
        : input.type === "PDF"
          ? "documents"
          : input.type === "TEXT"
            ? "text"
            : "flash";

  return `content/${directory}/${input.id}.${extension}`;
};

export const buildContentThumbnailKey = (id: string): string =>
  `content/thumbnails/${id}.jpg`;

export const buildContentPageFileKey = (input: {
  parentId: string;
  pageNumber: number;
}): string => {
  const pageNumber = Math.max(1, Math.trunc(input.pageNumber));
  const pageToken = String(pageNumber).padStart(4, "0");
  return `content/documents/${input.parentId}/pages/${pageToken}.pdf`;
};
