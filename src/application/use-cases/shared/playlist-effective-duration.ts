import { type ContentRepository } from "#/application/ports/content";
import { splitPdfDocumentDurationAcrossPages } from "./pdf-duration";

export const DEFAULT_SCROLL_PX_PER_SECOND = 24;

const toPositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;

const computeOverflowExtraSeconds = (input: {
  displayWidth: number;
  displayHeight: number;
  contentWidth: number | null;
  contentHeight: number | null;
  scrollPxPerSecond: number;
}): number => {
  if (
    input.contentWidth === null ||
    input.contentHeight === null ||
    input.contentWidth <= 0 ||
    input.contentHeight <= 0
  ) {
    return 0;
  }
  const scaledHeight =
    (input.displayWidth / input.contentWidth) * input.contentHeight;
  const overflow = Math.max(0, scaledHeight - input.displayHeight);
  if (overflow <= 0) {
    return 0;
  }
  return Math.ceil(overflow / toPositiveInteger(input.scrollPxPerSecond, 24));
};

const resolveScrollPxPerSecond = (input: {
  content: {
    type: string;
    kind?: string;
    scrollPxPerSecond?: number | null;
    parentContentId?: string | null;
  };
  parentById: Map<
    string,
    {
      scrollPxPerSecond?: number | null;
    }
  >;
  defaultScrollPxPerSecond: number;
}): number => {
  const defaultScrollPxPerSecond = toPositiveInteger(
    input.defaultScrollPxPerSecond,
    DEFAULT_SCROLL_PX_PER_SECOND,
  );
  if (input.content.type !== "IMAGE" && input.content.type !== "PDF") {
    return defaultScrollPxPerSecond;
  }
  if (
    input.content.scrollPxPerSecond != null &&
    input.content.scrollPxPerSecond > 0
  ) {
    return input.content.scrollPxPerSecond;
  }
  if (input.content.kind === "PAGE" && input.content.parentContentId) {
    const parent = input.parentById.get(input.content.parentContentId);
    if (parent?.scrollPxPerSecond != null && parent.scrollPxPerSecond > 0) {
      return parent.scrollPxPerSecond;
    }
  }
  return defaultScrollPxPerSecond;
};

export interface PlaylistDurationItemInput {
  readonly contentId: string;
  readonly duration: number;
}

export interface PlaylistDurationItemBreakdown {
  readonly contentId: string;
  readonly baseDurationSeconds: number;
  readonly scrollExtraSeconds: number;
  readonly effectiveDurationSeconds: number;
}

export interface PlaylistDurationComputation {
  readonly baseDurationSeconds: number;
  readonly scrollExtraSeconds: number;
  readonly effectiveDurationSeconds: number;
  readonly items: readonly PlaylistDurationItemBreakdown[];
}

export const computePlaylistEffectiveDuration = async (input: {
  items: readonly PlaylistDurationItemInput[];
  contentRepository: ContentRepository;
  displayWidth: number;
  displayHeight: number;
  defaultScrollPxPerSecond?: number;
  ownerId?: string;
}): Promise<PlaylistDurationComputation> => {
  if (input.items.length === 0) {
    return {
      baseDurationSeconds: 0,
      scrollExtraSeconds: 0,
      effectiveDurationSeconds: 0,
      items: [],
    };
  }

  const requestedContentIds = Array.from(
    new Set(input.items.map((item) => item.contentId)),
  );
  const contents =
    input.ownerId !== undefined && input.contentRepository.findByIdsForOwner
      ? await input.contentRepository.findByIdsForOwner(
          requestedContentIds,
          input.ownerId,
        )
      : await input.contentRepository.findByIds(requestedContentIds);
  const contentById = new Map(contents.map((content) => [content.id, content]));

  const parentIdsToLoad = Array.from(
    new Set(
      contents
        .filter((content) => content.kind === "PAGE" && content.parentContentId)
        .map((content) => content.parentContentId as string),
    ),
  ).filter((id) => !contentById.has(id));
  if (parentIdsToLoad.length > 0) {
    const parents =
      input.ownerId !== undefined && input.contentRepository.findByIdsForOwner
        ? await input.contentRepository.findByIdsForOwner(
            parentIdsToLoad,
            input.ownerId,
          )
        : await input.contentRepository.findByIds(parentIdsToLoad);
    for (const parent of parents) {
      contentById.set(parent.id, parent);
    }
  }

  const parentById = new Map(
    Array.from(contentById.values()).map((content) => [
      content.id,
      { scrollPxPerSecond: content.scrollPxPerSecond },
    ]),
  );

  const rootPdfIds = Array.from(
    new Set(
      input.items
        .map((item) => contentById.get(item.contentId))
        .filter(
          (content): content is NonNullable<typeof content> =>
            content?.kind === "ROOT" && content.type === "PDF",
        )
        .map((content) => content.id),
    ),
  );

  const childPagesByParentId = new Map<string, typeof contents>();
  if (
    rootPdfIds.length > 0 &&
    (input.ownerId !== undefined
      ? input.contentRepository.findChildrenByParentIdsForOwner
      : input.contentRepository.findChildrenByParentIds)
  ) {
    const childPages =
      input.ownerId !== undefined &&
      input.contentRepository.findChildrenByParentIdsForOwner
        ? await input.contentRepository.findChildrenByParentIdsForOwner(
            rootPdfIds,
            input.ownerId,
            {
              includeExcluded: false,
              onlyReady: true,
            },
          )
        : await input.contentRepository.findChildrenByParentIds!(rootPdfIds, {
            includeExcluded: false,
            onlyReady: true,
          });
    for (const childPage of childPages) {
      if (!childPage.parentContentId) {
        continue;
      }
      const current = childPagesByParentId.get(childPage.parentContentId) ?? [];
      childPagesByParentId.set(childPage.parentContentId, [
        ...current,
        childPage,
      ]);
    }
    for (const [parentId, pages] of childPagesByParentId) {
      childPagesByParentId.set(
        parentId,
        [...pages].sort(
          (left, right) => (left.pageNumber ?? 0) - (right.pageNumber ?? 0),
        ),
      );
    }
  }

  let baseDurationSeconds = 0;
  let scrollExtraSeconds = 0;
  const itemBreakdown: PlaylistDurationItemBreakdown[] = [];
  const defaultScrollPxPerSecond = toPositiveInteger(
    input.defaultScrollPxPerSecond ?? DEFAULT_SCROLL_PX_PER_SECOND,
    DEFAULT_SCROLL_PX_PER_SECOND,
  );

  for (const item of input.items) {
    const content = contentById.get(item.contentId);
    if (!content) {
      continue;
    }

    let itemBaseDurationSeconds = 0;
    let itemScrollExtraSeconds = 0;

    if (content.kind === "ROOT" && content.type === "PDF") {
      const childPages = childPagesByParentId.get(content.id) ?? [];
      const pages = childPages.length > 0 ? childPages : [content];
      const pageDurations = splitPdfDocumentDurationAcrossPages({
        totalDurationSeconds: item.duration,
        pageCount: pages.length,
      });
      for (const [index, page] of pages.entries()) {
        const pageDurationSeconds = pageDurations[index] ?? 1;
        itemBaseDurationSeconds += pageDurationSeconds;
        const pageScrollPxPerSecond = resolveScrollPxPerSecond({
          content: page,
          parentById,
          defaultScrollPxPerSecond,
        });
        itemScrollExtraSeconds += computeOverflowExtraSeconds({
          displayWidth: input.displayWidth,
          displayHeight: input.displayHeight,
          contentWidth: page.width,
          contentHeight: page.height,
          scrollPxPerSecond: pageScrollPxPerSecond,
        });
      }
    } else {
      itemBaseDurationSeconds += toPositiveInteger(item.duration, 1);
      const contentScrollPxPerSecond = resolveScrollPxPerSecond({
        content,
        parentById,
        defaultScrollPxPerSecond,
      });
      itemScrollExtraSeconds += computeOverflowExtraSeconds({
        displayWidth: input.displayWidth,
        displayHeight: input.displayHeight,
        contentWidth: content.width,
        contentHeight: content.height,
        scrollPxPerSecond: contentScrollPxPerSecond,
      });
    }

    baseDurationSeconds += itemBaseDurationSeconds;
    scrollExtraSeconds += itemScrollExtraSeconds;
    itemBreakdown.push({
      contentId: content.id,
      baseDurationSeconds: itemBaseDurationSeconds,
      scrollExtraSeconds: itemScrollExtraSeconds,
      effectiveDurationSeconds:
        itemBaseDurationSeconds + itemScrollExtraSeconds,
    });
  }

  return {
    baseDurationSeconds,
    scrollExtraSeconds,
    effectiveDurationSeconds: baseDurationSeconds + scrollExtraSeconds,
    items: itemBreakdown,
  };
};
