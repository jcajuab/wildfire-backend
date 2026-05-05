import { type DisplayRepository } from "#/application/ports/displays";

export class ListDisplayOutputOptionsUseCase {
  constructor(
    private readonly deps: { displayRepository: DisplayRepository },
  ) {}

  async execute() {
    if (this.deps.displayRepository.listOutputOptions) {
      return this.deps.displayRepository.listOutputOptions();
    }

    return [
      ...new Set(
        (await this.deps.displayRepository.list())
          .map((display) => display.output.trim())
          .filter((value) => value.length > 0),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }
}
