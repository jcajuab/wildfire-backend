export interface ContentPlaylistReportingPort {
  countPlaylistReferences(contentId: string): Promise<number>;
  countPlaylistReferencesByContentIds(
    contentIds: readonly string[],
  ): Promise<Map<string, number>>;
  listPlaylistsReferencingContent(
    contentId: string,
  ): Promise<{ id: string; name: string }[]>;
}
