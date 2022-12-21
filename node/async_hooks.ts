// deno-lint-ignore-file ban-types
// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

import { ERR_ASYNC_TYPE, ERR_INVALID_ASYNC_ID } from "./internal/errors.ts";
import { validateFunction, validateString } from "./internal/validators.mjs";
// import {
//   // deno-lint-ignore camelcase
//   async_id_symbol,
//   destroyHooksExist,
//   emitInit,
//   enabledHooksExist,
//   getDefaultTriggerAsyncId,
//   hasAsyncIdStack,
//   initHooksExist,
//   newAsyncId,
//   registerDestroyHook,
//   // deno-lint-ignore camelcase
//   trigger_async_id_symbol,
// } from "./internal/async_hooks.ts";
import {
  AsyncContext as DenoAsyncContext,
  AsyncHook as DenoAsyncHook,
  AsyncLocal as DenoAsyncLocal,
} from "../async/async_context.ts";

const asyncIdSymbol = Symbol("asyncId");
const contextTypeSymbol = Symbol("contextType");

function setAsyncId(context: object, asyncId: number) {
  (context as { [asyncIdSymbol]: number })[asyncIdSymbol] = asyncId;
}

function getAsyncId(context: object) {
  return (context as { [asyncIdSymbol]?: number })[asyncIdSymbol] ?? 0;
}

function getContextType(context: object) {
  return (context as { [contextTypeSymbol]?: string })[contextTypeSymbol] ?? (
    context instanceof Promise ? "PROMISE" : "Deno"
  );
}

setAsyncId(DenoAsyncContext.current(), 1);
let nextAsyncId = 2;

new DenoAsyncHook({
  init(context) {
    setAsyncId(context, nextAsyncId++);
  },
}).enable();

function createHook(callbacks: {
  init?: (
    asyncId: number,
    type: string,
    triggerAsyncId: number,
    resource: object,
  ) => void;
  before?: (asyncId: number) => void;
  after?: (asyncId: number) => void;
  destroy?: (asyncId: number) => void; // TODO: destroy hook not implemented.
  promiseResolve?: (asyncId: number) => void;
}) {
  return new DenoAsyncHook({
    ...(callbacks.init
      ? {
        init(context, parentContext) {
          callbacks.init!(
            getAsyncId(context),
            getContextType(context),
            getAsyncId(parentContext),
            context,
          );
        },
      }
      : {}),
    ...(callbacks.before
      ? {
        before(context) {
          callbacks.before!(getAsyncId(context));
        },
      }
      : {}),
    ...(callbacks.before
      ? {
        before(context) {
          callbacks.before!(getAsyncId(context));
        },
      }
      : {}),
    ...(callbacks.after
      ? {
        after(context) {
          callbacks.after!(getAsyncId(context));
        },
      }
      : {}),
    ...(callbacks.promiseResolve
      ? {
        promiseResolve(context) {
          callbacks.promiseResolve!(getAsyncId(context));
        },
      }
      : {}),
  });
}

export function executionAsyncResource() {
  return DenoAsyncContext.current();
}

export function executionAsyncId() {
  return getAsyncId(DenoAsyncContext.current());
}

export function triggerAsyncId() {
  return getAsyncId(DenoAsyncContext.parentOf(DenoAsyncContext.current()));
}

export const asyncWrapProviders = {};

type AsyncResourceOptions = number | {
  triggerAsyncId?: number;
  requireManualDestroy?: boolean;
};

export class AsyncResource {
  #triggerAsyncId: number;
  #asyncContext: DenoAsyncContext;
  [contextTypeSymbol]?: string;

  constructor(type: string, opts: AsyncResourceOptions = {}) {
    validateString(type, "type");

    let requireManualDestroy = false;
    if (typeof opts !== "number") {
      this.#triggerAsyncId = opts.triggerAsyncId ?? executionAsyncId();
      requireManualDestroy = !!opts.requireManualDestroy;
    } else {
      this.#triggerAsyncId = opts;
    }

    if (!Number.isSafeInteger(triggerAsyncId) || this.#triggerAsyncId < -1) {
      throw new ERR_INVALID_ASYNC_ID("triggerAsyncId", this.#triggerAsyncId);
    }

    if (typeof type !== "string" || type.length === 0) {
      throw new ERR_ASYNC_TYPE(type);
    }

    if (requireManualDestroy) {
      // TODO: destroy hook not implemented.
    }

    this.#asyncContext = new DenoAsyncContext(this);

    this[contextTypeSymbol] = type;
  }

  asyncId() {
    return getAsyncId(this);
  }

  triggerAsyncId() {
    return this.#triggerAsyncId;
  }

  emitDestroy() {
    // TODO: destroy hook not implemented.
    return this;
  }

  runInAsyncScope(
    fn: (...args: unknown[]) => unknown,
    thisArg?: unknown,
    ...args: unknown[]
  ) {
    validateFunction(fn, "fn");
    return this.#asyncContext.runInScope(() =>
      Reflect.apply(fn, thisArg, args)
    );
  }

  bind(fn: (...args: unknown[]) => unknown, thisArg: unknown = this) {
    validateFunction(fn, "fn");

    const ret = this.runInAsyncScope.bind(this, fn, thisArg);

    Object.defineProperties(ret, {
      "length": {
        configurable: true,
        enumerable: false,
        value: fn.length,
        writable: false,
      },
      "asyncResource": {
        configurable: true,
        enumerable: true,
        value: this,
        writable: true,
      },
    });

    return ret;
  }

  static bind(
    fn: (...args: unknown[]) => unknown,
    type: string | undefined,
    thisArg: unknown,
  ) {
    return (new AsyncResource(type ?? fn.name ?? "bound-anonymous-fn")).bind(
      fn,
      thisArg,
    );
  }
}

export class AsyncLocalStorage<T> {
  #asyncLocal = new DenoAsyncLocal<T | undefined>(undefined);
  #enabled = false;

  disable() {
    this.#enabled = false;
  }

  getStore() {
    return this.#enabled ? this.#asyncLocal.value : undefined;
  }

  enterWith(value: T) {
    this.#asyncLocal.value = value;
  }

  run<Args extends unknown[], Ret>(
    value: T,
    callback: (...args: Args) => Ret,
    ...args: Args
  ): Ret {
    this.#enabled = true;
    return this.#asyncLocal.withValue(value, () => callback(...args));
  }

  exit<Args extends unknown[], Ret>(
    callback: (...args: Args) => Ret,
    ...args: Args
  ): Ret {
    return this.#asyncLocal.withValue(undefined, () => callback(...args));
  }
}

// Placing all exports down here because the exported classes won't export
// otherwise.
export default {
  // Embedder API
  AsyncResource,
  AsyncLocalStorage,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  createHook,
};
