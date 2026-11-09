import { types } from 'node:util';
import { isMainThread } from 'node:worker_threads';
import { assertBeforeEffects } from '../../src/runtime/verification/before-effects.js';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import { createRoomTurnCustody } from './original-room-turn-custody.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';

const apply = Reflect.apply,
  read = Reflect.get,
  keys = Reflect.ownKeys,
  descriptor = Object.getOwnPropertyDescriptor,
  own = Object.hasOwn,
  prototype = Object.getPrototypeOf;
const NativePromise = Promise,
  then = Promise.prototype.then,
  isProxy = types.isProxy;
const empty = () => {};
const objectResource = {
  accept: (value: unknown) =>
    !!value && typeof value === 'object' && !isProxy(value),
  consumer: empty,
};
interface CleanupMethod {
  fn: Function;
  receiver: object;
}
interface LoadingTaskRecord extends CleanupMethod {
  value: object;
  fault?: { error: unknown };
}
function cleanupMethod(this: CleanupMethod): unknown {
  return apply(this.fn, this.receiver, []);
}
const cleanupResource = {
  accept: objectResource.accept,
  consumer: cleanupMethod,
};
interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}
function dataMethod(value: object, name: string): Function {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 128; depth++) {
    if (isProxy(current)) throw Error('PDF_METHOD_UNCONFIRMED');
    const slot = descriptor(current, name);
    if (slot) {
      if (
        !own(slot, 'value') ||
        typeof slot.value !== 'function' ||
        isProxy(slot.value)
      )
        throw Error('PDF_METHOD_UNCONFIRMED');
      return slot.value;
    }
    current = prototype(current);
  }
  throw Error('PDF_METHOD_UNCONFIRMED');
}

/** One original PDFJS body. Installed Main must enter the fixed source Worker;
 * the legacy Main lane and that Worker use this exact implementation. */
export async function extractOriginalPdfTextBody(
  bytes: Uint8Array,
  beforeEffects?: () => void,
): Promise<string> {
  if (isMainThread && hasOriginalMainSdkBridgeInstallation())
    throw Error('PDF_ORIGINAL_WORKER_REQUIRED');
  const nativeStock = isMainThread ? null : createRoomTurnCustody();
  // This adapter selects bookkeeping only from the actual execution realm.
  // It does not produce a Native capability; Main installation still requires
  // the original source Worker before this body can be invoked.
  const custody = {
    root: <T,>(work: () => Promise<T>): Promise<T> =>
      nativeStock ? nativeStock.root(work) : work(),
    sdk: <T,>(
      fn: Function,
      receiver: unknown,
      args: unknown[],
      resource?: typeof objectResource,
    ): Promise<T> =>
      nativeStock
        ? nativeStock.sdk<T>(fn, receiver, args, resource)
        : apply(fn, receiver, args),
    consumeResource: <T,>(
      fn: Function,
      resource: object,
      args: unknown[],
    ): Promise<T> =>
      nativeStock
        ? nativeStock.consumeResource<T>(fn, resource, args)
        : apply(fn, resource, args),
    inventory: (value: unknown): void => {
      nativeStock?.inventory(value);
    },
    waitPhysicalKnown: (): Promise<void> =>
      nativeStock ? nativeStock.waitPhysicalKnown() : NativePromise.resolve(),
  };
  let output: string | undefined, primary: { error: unknown } | undefined;
  const operation = custody.root(async () => {
    assertBeforeEffects(beforeEffects);
    const imported = import('pdfjs-dist/legacy/build/pdf.mjs');
    const children = () => {
      let malformed = false;
      const names = keys(imported);
      for (let i = 0; i < names.length; i++) {
        const name = names[i]!,
          slot = descriptor(imported, name);
        if (
          name === 'constructor' &&
          slot &&
          own(slot, 'value') &&
          slot.value === NativePromise
        )
          continue;
        if (!slot || !own(slot, 'value')) {
          malformed = true;
          continue;
        }
        custody.inventory(slot.value);
      }
      if (malformed) {
        custody.inventory(imported);
        throw Error('PDF_MODULE_UNCONFIRMED');
      }
    };
    children();
    assertStandardIpcPromise(imported, 'PDF_MODULE_UNCONFIRMED');
    const namespace = await new NativePromise<
      typeof import('pdfjs-dist/legacy/build/pdf.mjs')
    >((yes, no) => {
      const observer = apply(then, imported, [
        (value: typeof import('pdfjs-dist/legacy/build/pdf.mjs')) => {
          try {
            children();
            yes(value);
          } catch (error) {
            custody.inventory(error);
            no(error);
          }
        },
        (error: unknown) => {
          custody.inventory(error);
          try {
            children();
          } catch (secondary) {
            custody.inventory(secondary);
          }
          no(error);
        },
      ]);
      custody.inventory(observer);
    });
    const shell = await custody.sdk<{ fn: Function }>(
      () => {
        const slot = descriptor(namespace, 'getDocument');
        if (
          !slot ||
          !own(slot, 'value') ||
          typeof slot.value !== 'function' ||
          isProxy(slot.value)
        )
          throw Error('PDF_MODULE_UNCONFIRMED');
        return { fn: slot.value };
      },
      undefined,
      [],
      objectResource,
    );
    const invoke = async <T,>(
      resource: object,
      name: string,
      args: unknown[],
      contract?: typeof objectResource,
    ): Promise<T> => {
      const method = await custody.sdk<{ fn: Function }>(
        () => {
          const fn = dataMethod(resource, name);
          return { fn };
        },
        undefined,
        [],
        objectResource,
      );
      let result: T | undefined, failure: { error: unknown } | undefined;
      try {
        result = await custody.sdk<T>(method.fn, resource, args, contract);
      } catch (error) {
        failure = { error };
      }
      try {
        await custody.consumeResource(empty, method, []);
      } catch (error) {
        failure ??= { error };
      }
      if (failure) throw failure.error;
      return result!;
    };
    const captureCleanup = (
      resource: object,
      name: string,
    ): Promise<CleanupMethod> =>
      custody.sdk<CleanupMethod>(
        () => {
          const fn = dataMethod(resource, name);
          return { fn, receiver: resource };
        },
        undefined,
        [],
        cleanupResource,
      );
    assertBeforeEffects(beforeEffects);
    let loadingTask: object | undefined,
      taskCleanup: LoadingTaskRecord | undefined,
      docDelivery: Promise<object> | undefined,
      doc: object | undefined,
      bodyFailure: { error: unknown } | undefined;
    try {
      // Preserve the original acquired task and its actual cleanup method before
      // graph inventory can reject delivery. A rejected resource still closes.
      const acquired = await custody.sdk<LoadingTaskRecord>(
        () => {
          const value = apply(shell.fn, namespace, [{ data: bytes }]);
          if (!value || typeof value !== 'object' || isProxy(value))
            throw Error('PDF_TASK_UNCONFIRMED');
          let fn: Function;
          try {
            fn = dataMethod(value, 'destroy');
          } catch (error) {
            custody.inventory(value);
            throw error;
          }
          taskCleanup = { fn, receiver: value, value };
          // This exact promise belongs to the just-acquired original task.
          // Register its document outcome before traversing task._capability;
          // a generic observer must not misclassify the original proxy first.
          const capabilitySlot = descriptor(value, '_capability');
          const capability =
            capabilitySlot && own(capabilitySlot, 'value')
              ? capabilitySlot.value
              : undefined;
          const promiseSlot =
            capability && typeof capability === 'object' && !isProxy(capability)
              ? descriptor(capability, 'promise')
              : undefined;
          if (
            descriptor(value, 'promise') ||
            !promiseSlot ||
            !own(promiseSlot, 'value')
          ) {
            taskCleanup.fault = {
              error: Error('PDF_DOCUMENT_PROMISE_UNCONFIRMED'),
            };
            return taskCleanup;
          }
          const originalDocument = promiseSlot.value;
          docDelivery = custody.sdk<object>(
            () => originalDocument,
            undefined,
            [],
            objectResource,
          );
          custody.inventory(apply(then, docDelivery, [() => {}, () => {}]));
          return taskCleanup;
        },
        undefined,
        [],
        cleanupResource,
      );
      if (acquired.fault) throw acquired.fault.error;
      loadingTask = acquired.value;
      if (!docDelivery) throw Error('PDF_DOCUMENT_PROMISE_UNCONFIRMED');
      doc = await docDelivery;
      assertBeforeEffects(beforeEffects);
      const pageCount = await custody.sdk<number>(read, undefined, [
        doc,
        'numPages',
      ]);
      if (!Number.isSafeInteger(pageCount) || pageCount < 0)
        throw Error('PDF_PAGE_COUNT_UNCONFIRMED');
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        assertBeforeEffects(beforeEffects);
        const page = await invoke<object>(
          doc,
          'getPage',
          [pageNumber],
          objectResource,
        );
        const pageCleanup = await captureCleanup(page, 'cleanup');
        let pageFailure: { error: unknown } | undefined;
        try {
          assertBeforeEffects(beforeEffects);
          const content = await invoke<{ items: PdfTextItem[] }>(
            page,
            'getTextContent',
            [],
          );
          assertBeforeEffects(beforeEffects);
          let pageText = '';
          for (let i = 0; i < content.items.length; i++) {
            const item = content.items[i]!;
            if (typeof item.str !== 'string') continue;
            pageText += item.str;
            if (item.hasEOL) pageText += '\n';
          }
          if (pageText.trim()) pages.push(pageText.trim());
        } catch (error) {
          pageFailure = { error };
          custody.inventory(error);
        }
        try {
          await custody.consumeResource(cleanupMethod, pageCleanup, []);
        } catch (error) {
          custody.inventory(error);
          pageFailure ??= { error };
        }
        try {
          await custody.consumeResource(empty, page, []);
        } catch (error) {
          pageFailure ??= { error };
        }
        if (pageFailure) throw pageFailure.error;
      }
      output = pages.join('\n\n');
    } catch (error) {
      bodyFailure = { error };
      custody.inventory(error);
    }
    // Cleanup belongs to the accepted resource; withdrawal cannot skip it.
    if (taskCleanup)
      try {
        await custody.consumeResource(cleanupMethod, taskCleanup, []);
      } catch (error) {
        custody.inventory(error);
        bodyFailure ??= { error };
      }
    if (doc)
      try {
        await custody.consumeResource(empty, doc, []);
      } catch (error) {
        bodyFailure ??= { error };
      }
    try {
      await custody.consumeResource(empty, shell, []);
    } catch (error) {
      bodyFailure ??= { error };
    }
    if (bodyFailure) throw bodyFailure.error;
  });
  try {
    await operation;
  } catch (error) {
    primary = { error };
  }
  try {
    await custody.waitPhysicalKnown();
  } catch (error) {
    primary ??= { error };
  }
  if (primary) throw primary.error;
  return output!;
}
