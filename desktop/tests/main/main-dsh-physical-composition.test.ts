// @vitest-environment node
import { expect, it } from "vitest";
import {
  cacheOriginalMainDshPhysicalComposition,
  assertOriginalMainDshPhysicalCompositionCached,
} from "../../electron/main-dsh-physical-composition.js";

it("imports in Node and refuses foreign tuples without reflecting caller objects", async () => {
  let traps = 0;
  const foreign = new Proxy(
    {},
    {
      get() {
        traps++;
        throw Error("caller getter");
      },
      ownKeys() {
        traps++;
        throw Error("caller keys");
      },
      getOwnPropertyDescriptor() {
        traps++;
        throw Error("caller descriptor");
      },
    },
  );
  expect(() =>
    assertOriginalMainDshPhysicalCompositionCached(
      foreign,
      foreign,
      foreign,
      foreign,
    ),
  ).toThrow("DSH_ORIGINAL_PHYSICAL_COMPOSITION_REQUIRED");
  await expect(
    cacheOriginalMainDshPhysicalComposition(foreign, foreign, foreign, foreign),
  ).rejects.toThrow();
  expect(traps).toBe(0);
});

it("does not turn a rejected cache into a synchronous composition permission", async () => {
  const realm = Object.freeze({}),
    store = Object.freeze({}),
    runtime = Object.freeze({}),
    source = Object.freeze({});
  await expect(
    cacheOriginalMainDshPhysicalComposition(realm, store, runtime, source),
  ).rejects.toThrow();
  expect(() =>
    assertOriginalMainDshPhysicalCompositionCached(
      realm,
      store,
      runtime,
      source,
    ),
  ).toThrow("DSH_ORIGINAL_PHYSICAL_COMPOSITION_REQUIRED");
});
