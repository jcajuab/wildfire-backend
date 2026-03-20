import { sValidator } from "@hono/standard-validator";
import { type StandardSchemaV1 } from "@standard-schema/spec";
import { type Context } from "hono";
import { validator } from "hono-openapi";
import {
  parseValidationDetails,
  validationError,
} from "#/interfaces/http/responses";

type HookResult = Response | undefined | Promise<Response | undefined>;

type ValidationHookIssueBag = {
  issues?: readonly StandardSchemaV1.Issue[];
};

type ValidationHookResult =
  | {
      success: true;
      data: unknown;
      target: string;
      error?: never;
    }
  | {
      success: false;
      data: unknown;
      target: string;
      error: ValidationHookIssueBag["issues"];
    };

const validationHook = (
  result: ValidationHookResult,
  // biome-ignore lint/suspicious/noExplicitAny: hono 4.12 changed HonoRequest internals; cast needed for hook compat
  c: Context<any, any, any>,
): HookResult => {
  if (!result.success) {
    const issues = result.error;
    return validationError(
      c,
      "Invalid request",
      parseValidationDetails(issues),
    );
  }
};

const validateJson = <Schema extends StandardSchemaV1>(schema: Schema) =>
  // biome-ignore lint/suspicious/noExplicitAny: hook cast required for hono 4.12 validator type compatibility
  validator("json", schema, validationHook as any);

const validateForm = <Schema extends StandardSchemaV1>(schema: Schema) =>
  // biome-ignore lint/suspicious/noExplicitAny: sValidator returns Handler<Env> incompatible with typed routers in hono 4.12
  sValidator("form", schema, validationHook as any) as any;

const validateQuery = <Schema extends StandardSchemaV1>(schema: Schema) =>
  // biome-ignore lint/suspicious/noExplicitAny: hook cast required for hono 4.12 validator type compatibility
  validator("query", schema, validationHook as any);

const validateParams = <Schema extends StandardSchemaV1>(schema: Schema) =>
  // biome-ignore lint/suspicious/noExplicitAny: hook cast required for hono 4.12 validator type compatibility
  validator("param", schema, validationHook as any);

export { validateJson, validateForm, validateQuery, validateParams };
