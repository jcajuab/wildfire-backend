import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const srcRoot = join(repoRoot, "src");

const toRepoPath = (absolutePath: string): string =>
  relative(repoRoot, absolutePath).split(sep).join("/");

const collectSourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(entryPath);
      }

      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        return [];
      }

      return [entryPath];
    }),
  );

  return files.flat();
};

const listRepoPaths = async (directory: string): Promise<string[]> =>
  (await collectSourceFiles(directory)).map(toRepoPath).sort();

const findImports = async (
  directory: string,
  matcher: (contents: string) => boolean,
): Promise<string[]> => {
  const files = await collectSourceFiles(directory);
  const matchingFiles = await Promise.all(
    files.map(async (filePath) => {
      const contents = await readFile(filePath, "utf8");
      return matcher(contents) ? toRepoPath(filePath) : null;
    }),
  );

  return matchingFiles.filter((value): value is string => value != null).sort();
};

describe("backend architecture boundaries", () => {
  test("application and domain layers stay isolated from interfaces and bootstrap", async () => {
    const applicationAndDomainImports = await findImports(srcRoot, (contents) =>
      /from ["']#\/(interfaces|bootstrap)\//u.test(contents),
    );

    const violations = applicationAndDomainImports.filter(
      (filePath) =>
        filePath.startsWith("src/application/") ||
        filePath.startsWith("src/domain/"),
    );

    expect(violations).toEqual([]);
  });

  test("domain layer does not depend on application or infrastructure", async () => {
    const violations = await findImports(join(srcRoot, "domain"), (contents) =>
      /from ["']#\/(application|infrastructure|interfaces|bootstrap)\//u.test(
        contents,
      ),
    );

    expect(violations).toEqual([]);
  });

  test("infrastructure layer does not depend on HTTP interface adapters", async () => {
    const violations = await findImports(
      join(srcRoot, "infrastructure"),
      (contents) => /from ["']#\/interfaces\//u.test(contents),
    );

    expect(violations).toEqual([]);
  });

  test("environment access stays in explicit runtime and infrastructure adapters", async () => {
    const envImportFiles = await findImports(srcRoot, (contents) =>
      /from ["']#\/env["']/u.test(contents),
    );

    expect(envImportFiles).toEqual(
      [
        "src/bootstrap/http/index.ts",
        "src/bootstrap/workers/audit/index.ts",
        "src/bootstrap/workers/content-ingestion/dlq-manager.ts",
        "src/bootstrap/workers/content-ingestion/entry-processor.ts",
        "src/bootstrap/workers/content-ingestion/index.ts",
        "src/bootstrap/workers/content-ingestion/runtime.ts",
        "src/bootstrap/workers/content-ingestion/stream-transport.ts",
        "src/index.ts",
        "src/infrastructure/db/client.ts",
        "src/infrastructure/db/repositories/display-auth-nonce.repo.ts",
        "src/infrastructure/db/repositories/display-pairing-code.repo.ts",
        "src/infrastructure/db/repositories/display-pairing-session.repo.ts",
        "src/infrastructure/db/repositories/display-preview.repo.ts",
        "src/infrastructure/notifications/log-email-change-verification-email.sender.ts",
        "src/infrastructure/notifications/log-invitation-email.sender.ts",
        "src/infrastructure/notifications/log-password-reset-email.sender.ts",
        "src/infrastructure/observability/logger.ts",
        "src/infrastructure/redis/client.ts",
        "src/infrastructure/content-jobs/content-job-events.ts",
        "src/infrastructure/displays/admin-lifecycle-events.ts",
        "src/infrastructure/displays/display-stream.ts",
        "src/infrastructure/displays/registration-attempt-events.ts",
        "src/infrastructure/displays/registration-attempt.store.ts",
        "src/interfaces/http/security/redis-auth-security.store.ts",
      ].sort(),
    );
  });

  test("direct database client access stays in repositories and bootstrap health/runtime", async () => {
    const dbClientImportFiles = await findImports(srcRoot, (contents) =>
      /#\/infrastructure\/db\/client/u.test(contents),
    );

    expect(dbClientImportFiles).toEqual(
      [
        "src/application/reporting/content-playlist-reporting.ts",
        "src/bootstrap/http/health-checks.ts",
        "src/bootstrap/http/index.ts",
        "src/bootstrap/workers/audit/index.ts",
        "src/bootstrap/workers/content-ingestion/entry-processor.ts",
        "src/bootstrap/workers/content-ingestion/index.ts",
        "src/bootstrap/workers/content-ingestion/job-processor.ts",
        "src/infrastructure/db/repositories/audit-logs.repo.ts",
        "src/infrastructure/db/repositories/auth-session.repo.ts",
        "src/infrastructure/db/repositories/authorization.repo.ts",
        "src/infrastructure/db/repositories/content-job.repo.ts",
        "src/infrastructure/db/repositories/content.repo.queries.ts",
        "src/infrastructure/db/repositories/content.repo.shared.ts",
        "src/infrastructure/db/repositories/content.repo.writes.ts",
        "src/infrastructure/db/repositories/display-groups.repo.ts",
        "src/infrastructure/db/repositories/display-key.repo.ts",
        "src/infrastructure/db/repositories/display.repo.ts",
        "src/infrastructure/db/repositories/email-change-token.repo.ts",
        "src/infrastructure/db/repositories/invitation.repo.ts",
        "src/infrastructure/db/repositories/password-reset-token.repo.ts",
        "src/infrastructure/db/repositories/permission.repo.ts",
        "src/infrastructure/db/repositories/playlist.repo.ts",
        "src/infrastructure/db/repositories/role-permission.repo.ts",
        "src/infrastructure/db/repositories/role.repo.ts",
        "src/infrastructure/db/repositories/runtime-control.repo.ts",
        "src/infrastructure/db/repositories/schedule.repo.ts",
        "src/infrastructure/db/repositories/user-role.repo.ts",
        "src/infrastructure/db/repositories/user.repo.ts",
        "src/interfaces/http/startup/admin-identity-manager.service.ts",
      ].sort(),
    );
  });

  test("HTTP interfaces do not depend on concrete database repository implementations", async () => {
    const interfaceFiles = await listRepoPaths(join(srcRoot, "interfaces"));
    const repositoryImportFiles = await findImports(
      join(srcRoot, "interfaces"),
      (contents) => /#\/infrastructure\/db\/repositories\//u.test(contents),
    );

    expect(interfaceFiles.length).toBeGreaterThan(0);
    expect(repositoryImportFiles).toEqual([]);
  });

  test("HTTP interfaces do not construct application use cases", async () => {
    const violations = await findImports(
      join(srcRoot, "interfaces"),
      (contents) =>
        /new [A-Z][A-Za-z0-9]*UseCase\(|create[A-Z][A-Za-z0-9]*UseCases\(/u.test(
          contents,
        ),
    );

    expect(violations).toEqual([]);
  });

  test("HTTP interfaces do not import concrete runtime event or store adapters", async () => {
    const violations = await findImports(
      join(srcRoot, "interfaces"),
      (contents) =>
        /#\/infrastructure\/(content-jobs\/content-job-events|displays\/(admin-lifecycle-events|display-stream|registration-attempt-events|registration-attempt\.store))/u.test(
          contents,
        ),
    );

    expect(violations).toEqual([]);
  });
});
