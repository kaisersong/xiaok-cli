# continuity-device (in progress)

Main/worker-only OS credential IO. This package is **not** the production CryptoOutbox OS guard and is not connected to Desktop. A fixed device namespace lease is implemented; device provisioning, monotonic crypto/control state, online rollback witness, and the integrated worker lifecycle remain pending. No P4 enablement is granted by these IO tests.

Pinned @napi-rs/keyring 2.1.1 (MIT, N-API), direct fixed platform binding. Only macOS arm64/x64 and Windows x64 may load it. No Linux memory fallback, native-path/WASI override, withTarget constructor writes, credential enumeration, argv/env secrets, or raw backend errors. Byte secrets <=2048, synchronous compare/write/readback, any mismatch or uncertain write poisons the instance. Comparison is safe only under the future fixed device owner's lifetime lock; it is not an OS-native CAS.

Windows default persistence and macOS Keychain semantics must be qualified before production use. The fixed registration/independent OS floor and online witness requirements are not waived. Real Electron packaging and Windows ACL tests remain gates.

`node --test test/device-lock.test.mjs test/os-backend.test.mjs` runs isolated lease and fault-injection IO contracts without OS credential access. `npm test` also includes actual OS qualification and can require an unlocked system credential store.

`claimDeviceNamespace` validates the signed coordinator identity and takes a lifetime SQLite lock in the actual OS account’s fixed private registry. `close()` invalidates immediately; `drainClosed()` waits for original tracked work. Its original-object brand never confers `os-protected`. `run()` returns only bounded plain metadata; secrets/Buffer values stay inside the future worker. Unsupported promises/thenables retain the lock until process exit. Windows remains closed pending ACL qualification.

 See the implementation design in mydocs for complete security and acceptance requirements. Install dependencies only inside this independent package; never rewrite root/Desktop shared node_modules links.
