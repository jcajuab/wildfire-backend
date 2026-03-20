import { type ContentStatus, type ContentType } from "#/domain/content/content";

export interface ContentRecord {
  id: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
  fileKey: string;
  thumbnailKey?: string | null;
  checksum: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  flashMessage?: string | null;
  flashTone?: "INFO" | "WARNING" | "CRITICAL" | null;
  textJsonContent?: string | null;
  textHtmlContent?: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ExtractedContentMetadata {
  width: number;
  height: number;
  duration: number | null;
}

export interface ContentRepository {
  create(
    input: Omit<ContentRecord, "createdAt" | "updatedAt">,
  ): Promise<ContentRecord>;
  findById(id: string): Promise<ContentRecord | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<ContentRecord | null>;
  findByIds(ids: string[]): Promise<ContentRecord[]>;
  findByIdsForOwner(ids: string[], ownerId: string): Promise<ContentRecord[]>;
  list(input: {
    offset: number;
    limit: number;
    status?: ContentStatus;
    type?: ContentType;
    search?: string;
    sortBy?: "createdAt" | "title" | "fileSize" | "type";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: ContentRecord[]; total: number }>;
  listForOwner(input: {
    ownerId: string;
    offset: number;
    limit: number;
    status?: ContentStatus;
    type?: ContentType;
    search?: string;
    sortBy?: "createdAt" | "title" | "fileSize" | "type";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: ContentRecord[]; total: number }>;
  update(
    id: string,
    input: Partial<
      Pick<
        ContentRecord,
        | "title"
        | "status"
        | "fileKey"
        | "thumbnailKey"
        | "type"
        | "mimeType"
        | "fileSize"
        | "width"
        | "height"
        | "duration"
        | "flashMessage"
        | "flashTone"
        | "textJsonContent"
        | "textHtmlContent"
        | "checksum"
      >
    >,
  ): Promise<ContentRecord | null>;
  updateForOwner(
    id: string,
    ownerId: string,
    input: Partial<
      Pick<
        ContentRecord,
        | "title"
        | "status"
        | "fileKey"
        | "thumbnailKey"
        | "type"
        | "mimeType"
        | "fileSize"
        | "width"
        | "height"
        | "duration"
        | "flashMessage"
        | "flashTone"
        | "textJsonContent"
        | "textHtmlContent"
        | "checksum"
      >
    >,
  ): Promise<ContentRecord | null>;
  delete(id: string): Promise<boolean>;
  deleteForOwner(id: string, ownerId: string): Promise<boolean>;
}

export interface ContentStorage {
  ensureBucketExists(): Promise<void>;
  upload(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    contentLength: number;
  }): Promise<void>;
  download?(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  getPresignedDownloadUrl(input: {
    key: string;
    expiresInSeconds: number;
    responseContentDisposition?: string;
  }): Promise<string>;
  checkConnectivity(): Promise<{ ok: boolean; error?: string }>;
}

export interface ContentMetadataExtractor {
  extract(input: {
    type: ContentType;
    mimeType: string;
    data: Uint8Array;
  }): Promise<ExtractedContentMetadata>;
}

export interface ContentThumbnailGenerator {
  generate(input: {
    type: ContentType;
    mimeType: string;
    data: Uint8Array;
  }): Promise<Uint8Array | null>;
}
