import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { toApiListResponse } from "#/interfaces/http/responses";

const parseJson = async <T>(response: Response) => (await response.json()) as T;

describe("API list response contracts", () => {
  test("returns canonical list meta envelope", async () => {
    const app = new Hono();
    app.get("/items", (c) =>
      c.json(
        toApiListResponse({
          items: [{ id: "item-1", name: "Item 1" }],
          total: 1,
          page: 1,
          pageSize: 20,
          requestUrl: c.req.url,
        }),
      ),
    );

    const response = await app.request("/items?page=1&pageSize=20");
    expect(response.status).toBe(200);

    const body = await parseJson<{
      data: Array<{ id: string; name: string }>;
      meta: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
      links: {
        self: string;
        first: string;
        last: string;
      };
    }>(response);

    expect(body.data).toEqual([{ id: "item-1", name: "Item 1" }]);
    expect(body.meta).toEqual({
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(body.links.self).toContain("/items");
  });

  test("enforces minimum total_pages of 1 when total is 0", async () => {
    const app = new Hono();
    app.get("/items", (c) =>
      c.json(
        toApiListResponse({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          requestUrl: c.req.url,
        }),
      ),
    );

    const response = await app.request("/items");
    expect(response.status).toBe(200);

    const body = await parseJson<{
      data: Array<Record<string, unknown>>;
      meta: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
    }>(response);

    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
    expect(body.meta.totalPages).toBe(1);
  });
});
