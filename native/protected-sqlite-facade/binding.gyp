{
  "targets": [
    {
      "target_name": "protected_sqlite",
      "conditions": [
        [
          "OS=='mac'",
          {
            "sources": [
              "protected-sqlite-facade.c",
              "../root-resource-authority/budget-worker-native-bridge.cc",
              "admission-namespace-bridge.cc",
              "../root-resource-authority/original-root-io-vfs.c",
              "../root-resource-authority/installed-main-client.c",
              "../main-installation/wire.c"
            ],
            "include_dirs": [
              "../root-resource-authority",
              "../main-installation"
            ],
            "defines": ["NAPI_VERSION=8", "NR_ADMISSION_NAMESPACE_BRIDGE=1"],
            "cflags_c": ["-std=c11"],
            "cflags_cc": ["-std=c++20"],
            "libraries": [
              "-lsqlite3",
              "-framework Security",
              "-framework CoreFoundation",
              "-framework OpenDirectory",
              "-lbsm"
            ],
            "xcode_settings": {"GCC_C_LANGUAGE_STANDARD": "c11", "CLANG_CXX_LANGUAGE_STANDARD": "c++20"}
          },
          {"type": "none"}
        ]
      ]
    }
  ]
}
