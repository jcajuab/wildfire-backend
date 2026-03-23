import { type DisplayRepository } from "#/application/ports/displays";
import { normalizeQuery } from "#/shared/string-utils";

export class ListDisplayOptionsUseCase {
  constructor(
    private readonly deps: { displayRepository: DisplayRepository },
  ) {}

  async execute(input?: { q?: string; limit?: number }) {
    const normalizedQuery = normalizeQuery(input?.q);
    const limit = input?.limit;
    const displays = (await this.deps.displayRepository.list())
      .filter((display) =>
        normalizedQuery
          ? [display.name, display.slug, display.location ?? ""].some((value) =>
              value.toLowerCase().includes(normalizedQuery),
            )
          : true,
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((display) => ({
        id: display.id,
        name: display.name,
      }));

    return limit != null ? displays.slice(0, Math.max(1, limit)) : displays;
  }
}
