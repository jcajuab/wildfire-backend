export interface ContentPlaylistReportingRepository {
  countPlaylistReferences(contentId: string): Promise<number>;
  listPlaylistsReferencingContent(
    contentId: string,
  ): Promise<{ id: string; name: string }[]>;
}
