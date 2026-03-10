import { eq } from "drizzle-orm";
import { type ContentRecord } from "#/application/ports/content";
import {
  parseContentKind,
  parseContentStatus,
  parseContentType,
} from "#/domain/content/content";
import { db } from "#/infrastructure/db/client";
import {
  content,
  contentAssets,
  contentFlashMessages,
  contentTextContent,
} from "#/infrastructure/db/schema/content.sql";

export type ContentRow = {
  id: string;
  title: string;
  type: string;
  kind: string;
  status: string;
  parentContentId: string | null;
  pageNumber: number | null;
  pageCount: number | null;
  isExcluded: boolean;
  ownerId: string;
  createdAt: Date | string;
  fileKey: string | null;
  thumbnailKey: string | null;
  checksum: string | null;
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  scrollPxPerSecond: number | null;
  flashMessage: string | null;
  flashTone: "INFO" | "WARNING" | "CRITICAL" | null;
  textJsonContent: string | null;
  textHtmlContent: string | null;
};

export interface ContentListInput {
  ownerId?: string;
  offset: number;
  limit: number;
  parentId?: string;
  status?: ContentRecord["status"];
  type?: ContentRecord["type"];
  search?: string;
  sortBy?: "createdAt" | "title" | "fileSize" | "type" | "pageNumber";
  sortDirection?: "asc" | "desc";
}

export interface ContentChildrenInput {
  includeExcluded?: boolean;
  onlyReady?: boolean;
}

export type ContentUpdateInput = Partial<
  Pick<
    ContentRecord,
    | "title"
    | "kind"
    | "status"
    | "fileKey"
    | "thumbnailKey"
    | "parentContentId"
    | "pageNumber"
    | "pageCount"
    | "isExcluded"
    | "type"
    | "mimeType"
    | "fileSize"
    | "width"
    | "height"
    | "duration"
    | "scrollPxPerSecond"
    | "flashMessage"
    | "flashTone"
    | "textJsonContent"
    | "textHtmlContent"
    | "checksum"
  >
>;

export const buildBaseContentQuery = () =>
  db
    .select({
      id: content.id,
      title: content.title,
      type: content.type,
      kind: content.kind,
      status: content.status,
      parentContentId: content.parentContentId,
      pageNumber: content.pageNumber,
      pageCount: content.pageCount,
      isExcluded: content.isExcluded,
      ownerId: content.ownerId,
      createdAt: content.createdAt,
      fileKey: contentAssets.fileKey,
      thumbnailKey: contentAssets.thumbnailKey,
      checksum: contentAssets.checksum,
      mimeType: contentAssets.mimeType,
      fileSize: contentAssets.fileSize,
      width: contentAssets.width,
      height: contentAssets.height,
      duration: contentAssets.duration,
      scrollPxPerSecond: contentAssets.scrollPxPerSecond,
      flashMessage: contentFlashMessages.message,
      flashTone: contentFlashMessages.tone,
      textJsonContent: contentTextContent.jsonContent,
      textHtmlContent: contentTextContent.htmlContent,
    })
    .from(content)
    .innerJoin(contentAssets, eq(contentAssets.contentId, content.id))
    .leftJoin(
      contentFlashMessages,
      eq(contentFlashMessages.contentId, content.id),
    )
    .leftJoin(contentTextContent, eq(contentTextContent.contentId, content.id));

export const mapContentRowToRecord = (row: ContentRow): ContentRecord => {
  const parsedType = parseContentType(row.type);
  if (!parsedType) {
    throw new Error(`Invalid content type: ${row.type}`);
  }
  const parsedKind = parseContentKind(row.kind);
  if (!parsedKind) {
    throw new Error(`Invalid content kind: ${row.kind}`);
  }
  const parsedStatus = parseContentStatus(row.status);
  if (!parsedStatus) {
    throw new Error(`Invalid content status: ${row.status}`);
  }

  if (
    row.fileKey == null ||
    row.checksum == null ||
    row.mimeType == null ||
    row.fileSize == null
  ) {
    throw new Error(`Missing content asset row for content ${row.id}`);
  }

  return {
    id: row.id,
    title: row.title,
    type: parsedType,
    kind: parsedKind,
    status: parsedStatus,
    fileKey: row.fileKey,
    thumbnailKey: row.thumbnailKey,
    parentContentId: row.parentContentId,
    pageNumber: row.pageNumber,
    pageCount: row.pageCount,
    isExcluded: row.isExcluded,
    checksum: row.checksum,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    duration: row.duration,
    scrollPxPerSecond: row.scrollPxPerSecond,
    flashMessage: row.flashMessage,
    flashTone: row.flashTone,
    textJsonContent: row.textJsonContent,
    textHtmlContent: row.textHtmlContent,
    ownerId: row.ownerId,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
  };
};
