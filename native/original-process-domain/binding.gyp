{
  "targets": [{
    "target_name": "original_process_domain",
    "sources": ["process_domain.c"],
    "defines": ["NAPI_VERSION=8"],
    "cflags": ["-std=c11", "-Wall", "-Wextra", "-Werror"],
    "xcode_settings": {"GCC_C_LANGUAGE_STANDARD": "c11", "GCC_TREAT_WARNINGS_AS_ERRORS": "YES"}
  }]
}
