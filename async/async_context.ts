// deno-lint-ignore-file ban-types
const asyncLocalDataSymbol: unique symbol = Symbol("asyncLocalData");
const parentContextSymbol: unique symbol = Symbol("parentContext");

interface Context {
  [parentContextSymbol]?: Context;
  [asyncLocalDataSymbol]?: WeakMap<AsyncLocal<unknown>, unknown>;
}

const contextStack: Context[] = [];

interface AsyncHookCallbacks {
  init?: (context: object, parentContext: object) => void;
  before?: (context: object) => void;
  after?: (context: object) => void;
  promiseResolve?: (promise: Promise<unknown>) => void;
}

const asyncHookCallbacks: AsyncHookCallbacks[] = [];

function onInitContext(context: Context) {
  context[parentContextSymbol] = AsyncContext.current();

  for (const { init } of asyncHookCallbacks) {
    if (init) {
      init(context, context[parentContextSymbol]);
    }
  }
}

function onBeforeContext(context: Context) {
  contextStack.push(context);

  for (const { before } of asyncHookCallbacks) {
    if (before) {
      before(context);
    }
  }
}

function onAfterContext(context: Context) {
  const previousContext = contextStack.pop();
  if (previousContext && previousContext !== context) {
    contextStack.push(previousContext);
  }

  for (const { after } of asyncHookCallbacks) {
    if (after) {
      after(context);
    }
  }
}

function onPromiseResolve(promise: Promise<unknown>) {
  for (const { promiseResolve } of asyncHookCallbacks) {
    if (promiseResolve) {
      promiseResolve(promise);
    }
  }
}

let promiseTrackingEnabled = false;

function enablePromiseTracking() {
  if (!promiseTrackingEnabled) {
    promiseTrackingEnabled = true;

    // deno-lint-ignore ban-ts-comment
    // @ts-ignore
    Deno.core.setPromiseHooks(
      onInitContext,
      onBeforeContext,
      onAfterContext,
      onPromiseResolve,
    );
  }
}

export class AsyncContext {
  contextObject: Context;

  constructor(contextObject?: object) {
    this.contextObject = contextObject ?? this;
    onInitContext(this.contextObject);
  }

  static current() {
    return contextStack.at(-1) as object;
  }

  static parentOf(context: object) {
    return (context as Context)[parentContextSymbol] as object;
  }

  runInScope<U, Args extends unknown[]>(
    callback: (...args: Args) => U,
    ...args: Args
  ): U {
    onBeforeContext(this.contextObject);
    try {
      return Reflect.apply(callback, undefined, args);
    } finally {
      onAfterContext(this.contextObject);
    }
  }
}

const topLevelContext = new AsyncContext();
contextStack.push(topLevelContext as Context);

export class AsyncHook {
  #callbacks: AsyncHookCallbacks;

  constructor(callbacks: AsyncHookCallbacks) {
    this.#callbacks = callbacks;
  }

  enable() {
    enablePromiseTracking();
    asyncHookCallbacks.push(this.#callbacks);
  }

  disable() {
    const index = asyncHookCallbacks.indexOf(this.#callbacks);
    if (index >= 0) {
      asyncHookCallbacks.splice(index, 1);
    }
  }
}

/**
 * A AsyncLocal instance holds contextual data that is propagated throughout callbacks and
 * promise chains. It follows the asynchronous control flow, not the real sequencial control
 * flow. Be aware that there is a performance impact of using AsyncLocal.
 *
 * For example:
 *
 * ```ts
 * import { AsyncLocal } from "https://deno.land/std@$STD_VERSION/async/async_local.ts";
 *
 * function sleep(duration: number) {
 *   return new Promise(resolve => setTimeout(resolve, duration));
 * }
 *
 * const AsyncLocal<number> context;
 *
 * async function doAsyncOperation() {
 *   await sleep(100);
 *   console.log({ context: context.value });
 * }
 *
 * await Promise.all(
 *   async () => {
 *     context.value = 10;
 *     await sleep(100);
 *     console.log({ context: context.value });
 *   },
 *   context.withValue(20, doAsyncOperation),
 *   context.withValue(30, doAsyncOperation),
 *   context.withValue(40, doAsyncOperation)
 * );
 * ```
 */
export class AsyncLocal<T> {
  #initialValue: T;

  /**
   * Creates a new async local value.
   * @param value The initial value.
   */
  constructor(value: T) {
    enablePromiseTracking();
    this.#initialValue = value;
  }

  get value(): T {
    let context: Context | undefined = AsyncContext.current();

    while (context) {
      if (context[asyncLocalDataSymbol]?.has(this)) {
        return context[asyncLocalDataSymbol].get(this) as T;
      }

      context = context[parentContextSymbol]!;
    }

    return this.#initialValue;
  }

  set value(newValue: T) {
    const context = AsyncContext.current() as Context;
    const asyncLocalData = (context[asyncLocalDataSymbol] ??= new WeakMap<
      AsyncLocal<unknown>,
      unknown
    >());

    asyncLocalData.set(this, newValue);
  }

  withValue<U, Args extends unknown[]>(
    value: T,
    callback: (...args: Args) => U,
    ...args: Args
  ): U {
    const context = new AsyncContext();
    return context.runInScope(() => {
      this.value = value;
      return callback.apply(undefined, args);
    });
  }
}
