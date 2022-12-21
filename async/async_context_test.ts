import { Server } from "../http/server.ts";
import { assertEquals } from "../testing/asserts.ts";
import { AsyncLocal } from "./async_context.ts";

function sleep(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

Deno.test("[async] AsyncLocal<T> with async await", async () => {
  const asyncLocal = new AsyncLocal<string>("foo");
  assertEquals(asyncLocal.value, "foo");

  let firstFuncValue;
  let secondFuncValue;

  const promise1 = Promise.resolve().then(async () => {
    asyncLocal.value = "value 1";
    await sleep(20);
    firstFuncValue = asyncLocal.value;
  });

  const promise2 = Promise.resolve().then(async () => {
    asyncLocal.value = "value 2";
    await sleep(20);
    secondFuncValue = asyncLocal.value;
  });

  asyncLocal.value = "value 3";

  await promise1;
  await promise2;

  assertEquals(firstFuncValue, "value 1");
  assertEquals(secondFuncValue, "value 2");
  assertEquals(asyncLocal.value, "value 3");
});

Deno.test("[async] AsyncLocal<T> with HTTP server", async () => {
  const listenOptions = {
    hostname: "localhost",
    port: 4506,
  };
  const listener = Deno.listen(listenOptions);
  const url = `http://${listenOptions.hostname}:${listenOptions.port}`;

  const asyncLocal = new AsyncLocal("");

  function produceResponse() {
    return new Response(asyncLocal.value);
  }

  async function handler(request: Request) {
    const data = await request.text();
    return asyncLocal.withValue(data, async () => {
      await sleep(20);
      return produceResponse();
    });
  }

  const server = new Server({ handler });
  const servePromise = server.serve(listener);

  try {
    const expected = new Array(10).fill(0).map(() => crypto.randomUUID());
    const transformed = await Promise.all(
      expected.map((body) =>
        fetch(url, { method: "POST", body }).then((r) => r.text())
      ),
    );

    assertEquals(transformed, expected);
  } finally {
    server.close();
    await servePromise;
  }
});
