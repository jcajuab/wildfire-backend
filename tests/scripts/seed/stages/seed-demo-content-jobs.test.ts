import { describe, expect, test } from "bun:test";
import { DEMO_CONTENT_JOBS } from "../../../../scripts/seed/fixtures";
import { type SeedContext } from "../../../../scripts/seed/stage-types";
import { runSeedDemoContentJobs } from "../../../../scripts/seed/stages/seed-demo-content-jobs";

describe("runSeedDemoContentJobs", () => {
  test("creates and reconciles seeded jobs idempotently", async () => {
    const jobs = new Map<
      string,
      {
        id: string;
        contentId: string;
        operation: "UPLOAD" | "REPLACE";
        status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
        errorMessage: string | null;
        createdById: string;
        createdAt: string;
        updatedAt: string;
        startedAt: string | null;
        completedAt: string | null;
      }
    >();

    const ctx = {
      args: { dryRun: false },
      repos: {
        userRepository: {
          findByUsername: async () => ({
            id: "demo-content-user-id",
            username: "demo.content",
            email: "demo.content@demo.local",
            name: "Demo Content",
            isActive: true,
          }),
        },
        contentRepository: {
          findById: async (id: string) => ({
            id,
            title: "Demo Content",
            type: "PDF" as const,
            kind: "ROOT" as const,
            status: "READY" as const,
            fileKey: `demo/${id}.pdf`,
            thumbnailKey: null,
            parentContentId: null,
            pageNumber: null,
            pageCount: null,
            isExcluded: false,
            checksum: "seed-checksum",
            mimeType: "application/pdf",
            fileSize: 1,
            width: null,
            height: null,
            duration: null,
            createdById: "demo-content-user-id",
            createdAt: "2024-01-01T00:00:00.000Z",
          }),
        },
        contentIngestionJobRepository: {
          findById: async (id: string) => jobs.get(id) ?? null,
          create: async (input: {
            id: string;
            contentId: string;
            operation: "UPLOAD" | "REPLACE";
            status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
            errorMessage?: string | null;
            createdById: string;
          }) => {
            const now = "2024-01-01T00:00:00.000Z";
            const record = {
              id: input.id,
              contentId: input.contentId,
              operation: input.operation,
              status: input.status,
              errorMessage: input.errorMessage ?? null,
              createdById: input.createdById,
              createdAt: now,
              updatedAt: now,
              startedAt: null,
              completedAt: null,
            };
            jobs.set(input.id, record);
            return record;
          },
          update: async (
            id: string,
            input: {
              status?: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
              errorMessage?: string | null;
              startedAt?: string | null;
              completedAt?: string | null;
            },
          ) => {
            const existing = jobs.get(id) ?? null;
            if (!existing) return null;
            const updated = {
              ...existing,
              status: input.status ?? existing.status,
              errorMessage:
                input.errorMessage === undefined
                  ? existing.errorMessage
                  : input.errorMessage,
              startedAt:
                input.startedAt === undefined
                  ? existing.startedAt
                  : input.startedAt,
              completedAt:
                input.completedAt === undefined
                  ? existing.completedAt
                  : input.completedAt,
              updatedAt: "2024-01-01T00:00:01.000Z",
            };
            jobs.set(id, updated);
            return updated;
          },
        },
      },
    } as unknown as SeedContext;

    const first = await runSeedDemoContentJobs(ctx);
    expect(first.created).toBe(DEMO_CONTENT_JOBS.length);
    expect(first.updated).toBe(DEMO_CONTENT_JOBS.length);
    expect(first.skipped).toBe(0);

    const second = await runSeedDemoContentJobs(ctx);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(DEMO_CONTENT_JOBS.length);
  });
});
