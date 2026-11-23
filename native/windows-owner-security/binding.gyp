{
  "targets": [{
    "target_name": "windows_owner_security",
    "sources": ["windows-owner-security.c", "windows-profile-custody.c"],
    "defines": ["NAPI_VERSION=8", "WIN32_LEAN_AND_MEAN", "UNICODE", "_UNICODE"],
    "conditions": [["OS=='win'", {
      "libraries": ["advapi32.lib"],
      "msvs_settings": {"VCCLCompilerTool": {"AdditionalOptions": ["/W4"]}}
    }]]
  }]
}
