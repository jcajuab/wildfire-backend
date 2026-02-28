import {
  type StandardSchemaV1,
  type ValidationHookIssueBag,
} from "@standard-schema/spec";
import {
  type Context,
  type Env,
  type Input,
  type MiddlewareHandler,
  type ValidationTargets,
} from "hono";
import { type InputToDataByTarget } from "hono";
import { validator } from "hono-openapi";
import { sValidator } from "@hono/standard-validator";
import {
  parseValidationDetails,
  validationError,
} from "#/interfaces/http/responses";
import { type DescribeRouteOptions } from "hono-openapi";

declare module "hono" {
  interface HonoRequest<
    _P extends string = "/",
    I extends Input["out"] = Record<never, never>,
  > {
    valid<T extends keyof (I & ValidationTargets)>(
      target: T,
    ): InputToDataByTarget<I & ValidationTargets, T>;
  }
}

declare module "hono-openapi" {
  function describeRoute<
    E extends Env,
    P extends string,
    I extends Input = Input,
  >(spec: DescribeRouteOptions): MiddlewareHandler<E, P, I>;
}

type HookResult = Response | undefined | Promise<Response | undefined>;

type ValidationHookResult<T> =
  | {
      success: true;
      data: T;
      target: string;
      error?: never;
    }
  | {
      success: false;
      data: T;
      target: string;
      error: ValidationHookIssueBag["issues"];
    };

const validationHook = <SchemaInput>(
  _result: ValidationHookResult<SchemaInput>,
  _c: Context,
): HookResult => {
  if (!_result.success) {
    const issues = _result.error;
    return validationError(
      _c,
      "Invalid request",
      parseValidationDetails(issues),
    );
  }
};

const validateJson = <Schema extends StandardSchemaV1>(_schema: Schema) =>
  validator(
    "json",
    _schema,
    validationHook<StandardSchemaV1.InferOutput<Schema>>,
  );

const validateForm = <Schema extends StandardSchemaV1>(_schema: Schema) =>
  sValidator(
    "form",
    _schema,
    validationHook<StandardSchemaV1.InferOutput<Schema>>,
  );

const validateQuery = <Schema extends StandardSchemaV1>(_schema: Schema) =>
  validator(
    "query",
    _schema,
    validationHook<StandardSchemaV1.InferOutput<Schema>>,
  );

const validateParams = <Schema extends StandardSchemaV1>(_schema: Schema) =>
  validator(
    "param",
    _schema,
    validationHook<StandardSchemaV1.InferOutput<Schema>>,
  );

export { validateJson, validateForm, validateQuery, validateParams };
