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
  c: Context,
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
  validator("json", schema, validationHook);

const validateForm = <Schema extends StandardSchemaV1>(schema: Schema) =>
  sValidator("form", schema, validationHook);

const validateQuery = <Schema extends StandardSchemaV1>(schema: Schema) =>
  validator("query", schema, validationHook);

const validateParams = <Schema extends StandardSchemaV1>(schema: Schema) =>
  validator("param", schema, validationHook);

export { validateJson, validateForm, validateQuery, validateParams };
