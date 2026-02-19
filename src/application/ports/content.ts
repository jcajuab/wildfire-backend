import { type ContentStatus, type ContentType } from "#/domain/content/content";

export interface ContentRecord {
  id: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
  fileKey: string;
  checksum: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdById: string;
  createdAt: string;
}

export interface ExtractedContentMetadata {
  width: number;
  height: number;
  duration: number | null;
}

export interface ContentRepository {
  create(input: Omit<ContentRecord, "createdAt">): Promise<ContentRecord>;
  findById(id: string): Promise<ContentRecord | null>;
  findByIds(ids: string[]): Promise<ContentRecord[]>;
  list(input: {
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
    input: Partial<Pick<ContentRecord, "title" | "status">>,
  ): Promise<ContentRecord | null>;
  countPlaylistReferences(contentId: string): Promise<number>;
  delete(id: string): Promise<boolean>;
}

export interface ContentStorage {
  upload(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    contentLength: number;
  }): Promise<void>;
  delete(key: string): Promise<void>;
  getPresignedDownloadUrl(input: {
    key: string;
    expiresInSeconds: number;
    responseContentDisposition?: string;
  }): Promise<string>;
}

export interface ContentMetadataExtractor {
  extract(input: {
    type: ContentType;
    mimeType: string;
    data: Uint8Array;
  }): Promise<ExtractedContentMetadata>;
}
