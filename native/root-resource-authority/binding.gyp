{
  "variables": {
    "root_resource_fixture_header%": "",
    "root_resource_main_bridge%": 0
  },
  "targets": [
    {
      "target_name": "root_resource_authority",
      "conditions": [
        [
          "OS=='mac'",
          {
            "sources": [
              "root_resource_authority.c"
            ],
            "defines": [
              "NAPI_VERSION=8"
            ],
            "cflags": [
              "-std=c11"
            ],
            "libraries": [
              "-lsqlite3"
            ],
            "xcode_settings": {
              "GCC_C_LANGUAGE_STANDARD": "c11"
            }
          },
          {
            "type": "none"
          }
        ]
      ]
    },
    {
      "target_name": "root_resource_authority_fixture",
      "conditions": [
        [
          "OS=='mac' and root_resource_fixture_header!=''",
          {
            "sources": [
              "root_resource_authority.c"
            ],
            "defines": [
              "NAPI_VERSION=8",
              "NR_FIXTURE_BUILD=1"
            ],
            "cflags": [
              "-std=c11",
              "-include",
              "<(root_resource_fixture_header)"
            ],
            "libraries": [
              "-lsqlite3"
            ],
            "xcode_settings": {
              "GCC_C_LANGUAGE_STANDARD": "c11",
              "OTHER_CFLAGS": [
                "-include",
                "<(root_resource_fixture_header)"
              ]
            }
          },
          {
            "type": "none"
          }
        ]
      ]
    },
    {
      "target_name": "root_resource_authority_main",
      "conditions": [
        [
          "OS=='mac' and root_resource_main_bridge==1",
          {
            "sources": [
              "root_resource_authority.c",
              "main-bootstrap.cc",
              "original-root-io-vfs.c",
              "installed-main-client.c",
              "../main-installation/wire.c"
            ],
            "defines": [
              "NAPI_VERSION=8",
              "NR_MAIN_BOOTSTRAP_EMBEDDED=1",
              "V8_COMPRESS_POINTERS",
              "V8_ENABLE_SANDBOX",
              "NR_READONLY_LEAF_ASSETS_HEADER=\"readonly-leaf-assets.h\""
            ],
            "cflags_c": [
              "-std=c11"
            ],
            "cflags_cc": [
              "-std=c++20"
            ],
            "libraries": [
              "-lsqlite3",
              "-framework Security",
              "-lbsm"
            ],
            "xcode_settings": {
              "GCC_C_LANGUAGE_STANDARD": "c11",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20"
            },
            "dependencies": [
              "readonly_leaf_assets"
            ],
            "include_dirs": [
              "<(SHARED_INTERMEDIATE_DIR)"
            ]
          },
          {
            "type": "none"
          }
        ]
      ]
    },
    {
      "target_name": "root_resource_authority_main_fixture",
      "conditions": [
        [
          "OS=='mac' and root_resource_main_bridge==1 and root_resource_fixture_header!=''",
          {
            "sources": [
              "root_resource_authority.c",
              "main-bootstrap.cc",
              "original-root-io-vfs.c",
              "installed-main-client.c",
              "../main-installation/wire.c"
            ],
            "defines": [
              "NAPI_VERSION=8",
              "NR_MAIN_BOOTSTRAP_EMBEDDED=1",
              "V8_COMPRESS_POINTERS",
              "V8_ENABLE_SANDBOX",
              "NR_FIXTURE_BUILD=1",
              "NR_READONLY_LEAF_ASSETS_HEADER=\"readonly-leaf-assets.h\""
            ],
            "cflags_c": [
              "-std=c11"
            ],
            "cflags_cc": [
              "-std=c++20"
            ],
            "libraries": [
              "-lsqlite3",
              "-framework Security",
              "-lbsm"
            ],
            "xcode_settings": {
              "GCC_C_LANGUAGE_STANDARD": "c11",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
              "OTHER_CFLAGS": [
                "-include",
                "<(root_resource_fixture_header)"
              ],
              "OTHER_CPLUSPLUSFLAGS": [
                "-include",
                "<(root_resource_fixture_header)"
              ]
            },
            "cflags": [
              "-include",
              "<(root_resource_fixture_header)"
            ],
            "dependencies": [
              "readonly_leaf_assets"
            ],
            "include_dirs": [
              "<(SHARED_INTERMEDIATE_DIR)"
            ]
          },
          {
            "type": "none"
          }
        ]
      ]
    },
    {
      "target_name": "readonly_leaf_assets",
      "type": "none",
      "conditions": [
        [
          "OS=='mac' and root_resource_main_bridge==1",
          {
            "actions": [
              {
                "action_name": "build_original_readonly_leaf_assets",
                "inputs": [
                  "build-readonly-leaf-assets.mjs",
                  "../../src/ai/tools/readonly-leaf-driver.mjs",
                  "../../src/ai/tools/bounded-glob-body.mjs",
                  "../../src/ai/tools/search-scope.mjs",
                  "../../package-lock.json"
                ],
                "outputs": [
                  "<(PRODUCT_DIR)/readonly-leaf-driver.mjs",
                  "<(PRODUCT_DIR)/readonly-leaf-assets.json",
                  "<(SHARED_INTERMEDIATE_DIR)/readonly-leaf-assets.h"
                ],
                "action": [
                  "node",
                  "build-readonly-leaf-assets.mjs",
                  "<(PRODUCT_DIR)",
                  "<(SHARED_INTERMEDIATE_DIR)/readonly-leaf-assets.h"
                ]
              }
            ]
          }
        ]
      ]
    }
  ]
}
