import { describe, expect, test } from "bun:test";
import { ValidationError } from "#/application/errors/validation";
import { mapPlaylistItemInsertError } from "#/infrastructure/db/repositories/playlist.repo";

describe("mapPlaylistItemInsertError", () => {
  test("maps duplicate sequence index errors to ValidationError", () => {
    const duplicateError = Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
      sqlMessage:
        "Duplicate entry 'playlist-1-10' for key 'playlist_items_playlist_id_sequence_unique'",
    });

    const mapped = mapPlaylistItemInsertError(duplicateError);
    expect(mapped).toBeInstanceOf(ValidationError);
    expect(mapped.message).toBe("Sequence already exists in playlist");
  });

  test("returns original error for unrelated database failures", () => {
    const dbError = Object.assign(new Error("Connection reset"), {
      code: "ECONNRESET",
    });
    const mapped = mapPlaylistItemInsertError(dbError);
    expect(mapped).toBe(dbError);
  });
});
