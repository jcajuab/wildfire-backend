export { NotFoundError } from "#/application/errors/not-found";

export interface ScheduleConflictDetails {
  requested: {
    id?: string;
    name: string;
    kind: "PLAYLIST" | "FLASH";
    playlistId: string | null;
    contentId: string | null;
    displayId: string;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
  };
  conflicts: Array<{
    id: string;
    name: string;
    kind: "PLAYLIST" | "FLASH";
    playlistId: string | null;
    contentId: string | null;
    displayId: string;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
  }>;
}

export class ScheduleConflictError extends Error {
  public readonly details?: ScheduleConflictDetails;

  constructor(
    message = "This schedule overlaps with an existing schedule on the selected display.",
    detailsOrOptions?: ScheduleConflictDetails | ErrorOptions,
  ) {
    const details =
      detailsOrOptions &&
      "requested" in detailsOrOptions &&
      "conflicts" in detailsOrOptions
        ? detailsOrOptions
        : undefined;
    const options =
      detailsOrOptions && !("requested" in detailsOrOptions)
        ? detailsOrOptions
        : undefined;

    super(message, options);
    this.name = "ScheduleConflictError";
    this.details = details;
  }
}
