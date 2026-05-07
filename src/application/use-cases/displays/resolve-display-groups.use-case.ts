import { ValidationError } from "#/application/errors/validation";
import { type DisplayGroupRepository } from "#/application/ports/displays";
import { DisplayGroupConflictError } from "./errors";

const collapseWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const normalizeName = (value: string): string =>
  collapseWhitespace(value).toLowerCase();

export interface ResolveDisplayGroupsResult {
  items: Array<{ id: string; name: string }>;
}

export class ResolveDisplayGroupsUseCase {
  constructor(
    private readonly deps: { displayGroupRepository: DisplayGroupRepository },
  ) {}

  async execute(input: {
    names: readonly string[];
  }): Promise<ResolveDisplayGroupsResult> {
    if (input.names.length === 0) {
      return { items: [] };
    }

    const cleaned: Array<{ original: string; normalized: string }> = [];
    const seen = new Set<string>();
    for (const raw of input.names) {
      const collapsed = collapseWhitespace(raw);
      if (collapsed.length === 0) {
        throw new ValidationError("Group name is required");
      }
      const normalized = normalizeName(collapsed);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      cleaned.push({ original: collapsed, normalized });
    }

    const existingGroups = await this.deps.displayGroupRepository.list();
    const existingByNormalized = new Map(
      existingGroups.map(
        (group) => [normalizeName(group.name), group] as const,
      ),
    );

    const items: Array<{ id: string; name: string }> = [];
    for (const entry of cleaned) {
      const existing = existingByNormalized.get(entry.normalized);
      if (existing) {
        items.push({ id: existing.id, name: existing.name });
        continue;
      }
      try {
        const created = await this.deps.displayGroupRepository.create({
          name: entry.original,
        });
        existingByNormalized.set(entry.normalized, created);
        items.push({ id: created.id, name: created.name });
      } catch (error) {
        // Race: another writer created the group between list() and create().
        // Re-fetch and surface the existing record. If it is still missing, bubble.
        const reloaded = await this.deps.displayGroupRepository.findByName(
          entry.original,
        );
        if (reloaded) {
          items.push({ id: reloaded.id, name: reloaded.name });
          existingByNormalized.set(entry.normalized, reloaded);
          continue;
        }
        throw new DisplayGroupConflictError(
          `Failed to resolve display group "${entry.original}"`,
          { cause: error },
        );
      }
    }

    return { items };
  }
}
