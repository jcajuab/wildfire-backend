import {
  type ContentKind,
  type ContentStatus,
  type ContentType,
} from "#/domain/content/content";

export interface ContentRecord {
  id: string;
  title: string;
  type: ContentType;
  kind?: ContentKind;
  status: ContentStatus;
  fileKey: string;
  thumbnailKey?: string | null;
  parentContentId?: string | null;
  pageNumber?: number | null;
  pageCount?: number | null;
  isExcluded?: boolean;
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
    parentId?: string;
    status?: ContentStatus;
    type?: ContentType;
    search?: string;
    sortBy?: "createdAt" | "title" | "fileSize" | "type" | "pageNumber";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: ContentRecord[]; total: number }>;
  findChildrenByParentIds?(
    parentIds: string[],
    input?: {
      includeExcluded?: boolean;
      onlyReady?: boolean;
    },
  ): Promise<ContentRecord[]>;
  update(
    id: string,
    input: Partial<
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
        | "checksum"
      >
    >,
  ): Promise<ContentRecord | null>;
  countPlaylistReferences(contentId: string): Promise<number>;
  listPlaylistsReferencingContent(
    contentId: string,
  ): Promise<{ id: string; name: string }[]>;
  deleteByParentId?(parentId: string): Promise<ContentRecord[]>;
  delete(id: string): Promise<boolean>;
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
