// desktop/electron/cua-release-install.ts
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";

// desktop/electron/dependency-task.ts
import { spawn } from "node:child_process";
async function runDependencyProcess(command, args, options = {}) {
  if (options.signal?.aborted) return { success: false, error: "dependency_cancelled" };
  return new Promise((resolve) => {
    const ownsProcessGroup = process.platform !== "win32";
    const child = spawn(command, args, { shell: false, detached: ownsProcessGroup, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0;
    let failure;
    let forceStopTimer;
    const limit = options.maxOutputBytes ?? 1024 * 1024;
    const stop = (reason) => {
      failure ??= reason;
      try {
        if (ownsProcessGroup && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill();
        if (ownsProcessGroup && child.pid && !forceStopTimer) {
          const ownedGroup = child.pid;
          forceStopTimer = setTimeout(() => {
            try {
              process.kill(-ownedGroup, "SIGKILL");
            } catch {
            }
          }, 1e3);
        }
      } catch {
      }
    };
    const abort = () => stop("dependency_cancelled");
    const timer = setTimeout(() => stop("dependency_timeout"), options.timeoutMs ?? 12e4);
    const receive = (chunk) => {
      const buffer = Buffer.from(chunk);
      const remaining = Math.max(0, limit - bytes);
      if (remaining) chunks.push(buffer.subarray(0, remaining));
      bytes += buffer.length;
      if (bytes > limit) stop("dependency_output_limit");
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("error", (error2) => {
      failure ??= error2.message;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(forceStopTimer);
      options.signal?.removeEventListener("abort", abort);
      const output = Buffer.concat(chunks).toString("utf8").trim();
      resolve(failure || code !== 0 ? { success: false, error: failure ?? (output || `exit ${code}`), output } : { success: true, output });
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

// desktop/electron/windows-cua-host.ts
async function detectNativeWindowsArchitecture(signal) {
  if (process.platform !== "win32" || process.arch !== "x64") return "unsupported";
  const script = `$ProgressPreference='SilentlyContinue'; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class XiaokNativeArchitecture { [DllImport("kernel32.dll")] static extern void GetNativeSystemInfo(IntPtr p); public static int Read() { IntPtr p=Marshal.AllocHGlobal(64); try { GetNativeSystemInfo(p); return (int)(ushort)Marshal.ReadInt16(p); } finally { Marshal.FreeHGlobal(p); } } }'; [XiaokNativeArchitecture]::Read()`;
  const result = await runDependencyProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { signal, timeoutMs: 2e4, maxOutputBytes: 4096 });
  if (!result.success) return "unsupported";
  return result.output === "9" ? "x64" : result.output === "12" ? "arm64" : "unsupported";
}
async function detectWindowsInteractiveDesktop(signal) {
  if (process.platform !== "win32") return false;
  const script = `$ProgressPreference='SilentlyContinue'; if ((Get-Process -Id $PID).SessionId -le 0) { Write-Output 'unavailable'; exit }; Add-Type -TypeDefinition 'using System; using System.Text; using System.Diagnostics; using System.Runtime.InteropServices; public static class XiaokInputDesktop {
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint f, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr p);
    [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, uint length, out uint needed);
    [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode)] static extern bool WTSQuerySessionInformationW(IntPtr server, int session, int info, out IntPtr value, out int bytes);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr value);
    static string Name(IntPtr handle) { var value=new StringBuilder(256); uint needed; return GetUserObjectInformationW(handle,2,value,512,out needed) ? value.ToString() : ""; }
    public static bool Available() { IntPtr state; int bytes; if(!WTSQuerySessionInformationW(IntPtr.Zero,Process.GetCurrentProcess().SessionId,8,out state,out bytes)) return false;
      try { if(bytes<4 || Marshal.ReadInt32(state)!=0) return false; } finally { WTSFreeMemory(state); }
      if(!String.Equals(Name(GetProcessWindowStation()),"WinSta0",StringComparison.OrdinalIgnoreCase)) return false;
      IntPtr desktop=OpenInputDesktop(0,false,0x0001); if(desktop==IntPtr.Zero) return false;
      try { return String.Equals(Name(desktop),"Default",StringComparison.OrdinalIgnoreCase); } finally { CloseDesktop(desktop); }
    }
  }'; if ([XiaokInputDesktop]::Available()) { Write-Output 'available' } else { Write-Output 'unavailable' }`;
  const result = await runDependencyProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { signal, timeoutMs: 2e4, maxOutputBytes: 4096 });
  return result.success && result.output === "available";
}

// desktop/electron/cua-release-install.ts
var WINDOWS_CUA_RELEASE = Object.freeze({
  version: "0.31.0",
  tag: "cua-driver-rs-v0.31.0",
  sourceCommit: "5272e492d61b96caf08e3bf434d91126c1f3dccc",
  archiveRoot: "cua-driver-rs-0.31.0-windows-x86_64",
  sourceUrl: "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.31.0/cua-driver-rs-0.31.0-windows-x86_64.zip",
  sha256: "0c091deff7aa153e69f94c8a19039aaa62f34c9d0c86a23474fe3ea5c3d3b7d1",
  bytes: 30767151,
  signerCertificateSha256: "65EF88B2412945E4DC8F2CDF32C9184DA1D84E538306859C2F437A0EB7EFD96F",
  files: Object.freeze(["cua_driver_abi.h", "cua_driver_node_runtime.node", "cua_driver_sdk.dll", "cua-cursor-theme.exe", "cua-driver-uia.exe", "cua-driver.exe", "LICENSE"]),
  fileHashes: Object.freeze({
    "cua_driver_abi.h": "c17169f41da321baa5e7e953323c3ad660b00790176ba381e93189fba3506587",
    "cua_driver_node_runtime.node": "c2c4836e87126596dfdcc4dcb496dc7184d9b5f2d5ab8f03e086e96624185b27",
    "cua_driver_sdk.dll": "08939b5ff00c4f7825956caec732759604874c4a0bd90fb58a30cd62bbcd0659",
    "cua-cursor-theme.exe": "9b777eb0a7edca13c8bef09a856657e7f28efc4631703747249e985ce50722ba",
    "cua-driver-uia.exe": "87c9ab54f943a3dede6306174ab2bcf373226c167d9f9d92fa13fe85ef2e160a",
    "cua-driver.exe": "88c1e2a65e53e3a01d683c87ea45a25c8aaff7b15b369bec33624d30f51ce50d",
    "LICENSE": "d0a32419a44fa38d5023d1431dfcbedd1457eb5e7b2e6c7c87ca064facb41b41"
  })
});
var archiveError = () => new Error("cua_archive_invalid");
function parsePinnedReleaseZip(buffer) {
  if (buffer.length < 22 || buffer.length > 64 * 1024 * 1024) throw archiveError();
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 101010256 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
      end = i;
      break;
    }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw archiveError();
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (count > 100 || count !== buffer.readUInt16LE(end + 8) || directoryOffset + directorySize !== end) throw archiveError();
  const entries = [];
  const names = /* @__PURE__ */ new Set();
  let cursor = directoryOffset;
  let totalBytes = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 33639248) throw archiveError();
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedBytes = buffer.readUInt32LE(cursor + 20);
    const bytes = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const attributes = buffer.readUInt32LE(cursor + 38);
    const local = buffer.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd + extraLength + commentLength > end) throw archiveError();
    const name = buffer.subarray(cursor + 46, nameEnd).toString("utf8");
    const mode = attributes >>> 16 & 61440;
    if (flags & 1 || ![0, 8].includes(method) || name.includes("\\") || name.includes(":") || name.includes("\0") || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === "..") || mode !== 0 && mode !== 32768 || names.has(name.toLowerCase())) throw archiveError();
    if (local + 30 > directoryOffset || buffer.readUInt32LE(local) !== 67324752) throw archiveError();
    const localNameLength = buffer.readUInt16LE(local + 26);
    const localExtraLength = buffer.readUInt16LE(local + 28);
    const offset = local + 30 + localNameLength + localExtraLength;
    if (buffer.readUInt16LE(local + 8) !== method || buffer.readUInt16LE(local + 6) !== flags || buffer.subarray(local + 30, local + 30 + localNameLength).toString("utf8") !== name || offset + compressedBytes > directoryOffset || bytes > 64 * 1024 * 1024) throw archiveError();
    totalBytes += bytes;
    if (totalBytes > 128 * 1024 * 1024) throw archiveError();
    names.add(name.toLowerCase());
    entries.push({ name, offset, compressedBytes, bytes, method });
    cursor = nameEnd + extraLength + commentLength;
  }
  if (cursor !== end) throw archiveError();
  return entries;
}
async function downloadDependencyAsset(url, maxBytes, signal) {
  const timeout = AbortSignal.timeout(12e4);
  const boundedSignal = AbortSignal.any([signal, timeout]);
  const response = await fetch(url, { signal: boundedSignal });
  if (!response.ok || !response.body) throw new Error(`dependency_download_failed_${response.status}`);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel();
    throw new Error("dependency_download_limit");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      boundedSignal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("dependency_download_limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks);
}
function privateCuaReleaseDirectory(dataRoot) {
  return join(dataRoot, "runtime", "cua-driver", WINDOWS_CUA_RELEASE.version);
}
async function resolveActivePrivateCuaRelease(dataRoot) {
  try {
    const pointer = join(dataRoot, "runtime", "cua-driver", "active-version.json");
    const stat = await lstat(pointer);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
    const active = JSON.parse(await readFile(pointer, "utf8"));
    if (active.schemaVersion !== 1 || active.version !== WINDOWS_CUA_RELEASE.version || active.archiveSha256 !== WINDOWS_CUA_RELEASE.sha256) return null;
    const directory = privateCuaReleaseDirectory(dataRoot);
    return await verifyPrivateCuaRelease(directory) ? join(directory, "cua-driver.exe") : null;
  } catch {
    return null;
  }
}
async function verifyPrivateCuaRelease(directory, signal) {
  try {
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) return false;
    for (const name of WINDOWS_CUA_RELEASE.files) {
      signal?.throwIfAborted();
      const file = join(directory, name);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) return false;
      const bytes = await readFile(file);
      if (createHash("sha256").update(bytes).digest("hex") !== WINDOWS_CUA_RELEASE.fileHashes[name]) return false;
    }
    signal?.throwIfAborted();
    return true;
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}
async function verifyCuaAuthenticode(directory, signal) {
  if (process.platform !== "win32") throw new Error("unsupported_platform");
  const script = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; $sha=[System.Security.Cryptography.SHA256]::Create(); foreach($p in $args){ $s=Get-AuthenticodeSignature -LiteralPath $p; if($s.Status -ne 'Valid' -or !$s.SignerCertificate){throw 'cua_signature_invalid'}; $h=([BitConverter]::ToString($sha.ComputeHash($s.SignerCertificate.RawData))).Replace('-',''); if($h -ne '${WINDOWS_CUA_RELEASE.signerCertificateSha256}'){throw 'cua_signature_publisher_mismatch'} }; Write-Output 'cua_signature_valid'`;
  const signedFiles = WINDOWS_CUA_RELEASE.files.filter((name) => /\.(exe|dll|node)$/.test(name)).map((name) => join(directory, name));
  const scriptPath = join(directory, "verify-signatures.ps1");
  await writeFile(scriptPath, script, { flag: "wx" });
  try {
    const result = await runDependencyProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...signedFiles], { signal, timeoutMs: 6e4 });
    if (!result.success || !result.output?.includes("cua_signature_valid")) throw new Error("cua_signature_verification_failed");
  } finally {
    await rm(scriptPath, { force: true });
  }
}
async function renameCuaInstallArtifact(from, to, signal, move = rename) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      await move(from, to);
      return;
    } catch (error2) {
      signal.throwIfAborted();
      const code = error2 && typeof error2 === "object" ? error2.code : void 0;
      if (attempt >= 7 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error2;
      await delay((attempt + 1) * 100, void 0, { signal });
    }
  }
}
async function installPrivateCuaRelease(dataRoot, signal, offlineArchive) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("unsupported_platform");
  if (await detectNativeWindowsArchitecture(signal) !== "x64") throw new Error("unsupported_architecture");
  signal.throwIfAborted();
  const root = join(dataRoot, "runtime", "cua-driver");
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink()) throw new Error("cua_install_root_invalid");
  const staging = await mkdtemp(join(root, ".staging-"));
  const directory = privateCuaReleaseDirectory(dataRoot);
  let pointerTemp;
  try {
    const archive = offlineArchive ?? await downloadDependencyAsset(WINDOWS_CUA_RELEASE.sourceUrl, WINDOWS_CUA_RELEASE.bytes, signal);
    if (archive.length !== WINDOWS_CUA_RELEASE.bytes || createHash("sha256").update(archive).digest("hex") !== WINDOWS_CUA_RELEASE.sha256) throw new Error("cua_archive_hash_mismatch");
    const members = parsePinnedReleaseZip(archive);
    if (members.length !== WINDOWS_CUA_RELEASE.files.length) throw archiveError();
    for (const member of members) {
      signal.throwIfAborted();
      const name = member.name.slice(WINDOWS_CUA_RELEASE.archiveRoot.length + 1);
      if (member.name !== `${WINDOWS_CUA_RELEASE.archiveRoot}/${name}` || !WINDOWS_CUA_RELEASE.files.includes(name)) throw archiveError();
      const compressed = archive.subarray(member.offset, member.offset + member.compressedBytes);
      const bytes = member.method === 0 ? compressed : await promisify(inflateRaw)(compressed, { maxOutputLength: 64 * 1024 * 1024 });
      signal.throwIfAborted();
      if (bytes.length !== member.bytes || createHash("sha256").update(bytes).digest("hex") !== WINDOWS_CUA_RELEASE.fileHashes[name]) throw new Error("cua_file_hash_mismatch");
      await writeFile(join(staging, name), bytes, { flag: "wx" });
    }
    await verifyCuaAuthenticode(staging, signal);
    signal.throwIfAborted();
    const existing = await lstat(directory).catch(() => null);
    if (existing) {
      if (!await verifyPrivateCuaRelease(directory, signal)) throw new Error("cua_existing_release_invalid");
    } else {
      await renameCuaInstallArtifact(staging, directory, signal);
    }
    signal.throwIfAborted();
    pointerTemp = join(root, `.active-${staging.slice(staging.lastIndexOf("-") + 1)}.json`);
    await writeFile(pointerTemp, JSON.stringify({ schemaVersion: 1, version: WINDOWS_CUA_RELEASE.version, archiveSha256: WINDOWS_CUA_RELEASE.sha256 }), { flag: "wx" });
    signal.throwIfAborted();
    await renameCuaInstallArtifact(pointerTemp, join(root, "active-version.json"), signal);
    return join(directory, "cua-driver.exe");
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => {
    });
    if (pointerTemp) await rm(pointerTemp, { force: true }).catch(() => {
    });
  }
}

// src/platform/computer-use/cua-png.ts
import { crc32 } from "node:zlib";
function validateComputerUsePng(data) {
  const invalid = () => new Error("tool_image_invalid");
  if (typeof data !== "string" || data.length > 6 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw invalid();
  const buffer = Buffer.from(data, "base64");
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature) || buffer.toString("ascii", 12, 16) !== "IHDR" || buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", buffer.length - 8, buffer.length - 4) !== "IEND") throw invalid();
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) throw invalid();
  let offset = 8;
  let hasImageData = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw invalid();
    const size = buffer.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (end > buffer.length || crc32(buffer.subarray(offset + 4, end - 4)) !== buffer.readUInt32BE(end - 4)) throw invalid();
    const kind = buffer.toString("ascii", offset + 4, offset + 8);
    if (kind === "IDAT" && size) hasImageData = true;
    if (kind === "IEND" && (size !== 0 || end !== buffer.length)) throw invalid();
    if (offset > 8 && kind === "IHDR") throw invalid();
    offset = end;
  }
  if (!hasImageData) throw invalid();
  return { bytes: buffer.length, width, height };
}

// desktop/electron/tool-image-channel.ts
var InvocationToolImages = class {
  constructor(signal, supportsImages) {
    this.signal = signal;
    this.supportsImages = supportsImages;
    signal.addEventListener("abort", this.abort, { once: true });
    if (signal.aborted) this.abort();
  }
  images = [];
  bytes = 0;
  open = true;
  abort = () => {
    this.images = [];
    this.open = false;
  };
  emit = (image) => {
    this.signal.throwIfAborted();
    if (!this.open) throw new Error("tool_image_invocation_closed");
    if (!this.supportsImages) throw new Error("COMPUTER_USE_MODEL_IMAGE_DISABLED");
    if (image.type !== "image" || image.source.type !== "base64" || image.source.media_type !== "image/png" || typeof image.source.data !== "string") throw new Error("tool_image_invalid");
    const png = validateComputerUsePng(image.source.data);
    if (this.images.length >= 4 || this.bytes + png.bytes > 8 * 1024 * 1024) throw new Error("tool_image_limit");
    this.bytes += png.bytes;
    this.images.push({ type: "image", source: { type: "base64", media_type: "image/png", data: image.source.data } });
  };
  finish(ok) {
    this.signal.removeEventListener("abort", this.abort);
    const result = ok && this.open && !this.signal.aborted ? this.images : [];
    this.images = [];
    this.bytes = 0;
    this.open = false;
    return result;
  }
};

// src/platform/computer-use/cua-action-contract.ts
var IDENTIFIER_FIELDS = Object.freeze(["pid", "window_id", "element_index"]);
var SNAPSHOT_ID_PATTERN = /^s[0-9a-f]{8}$/;
var GET_WINDOW_STATE_ALLOWED = Object.freeze([
  "capture_mode",
  "include_screenshot",
  "max_depth",
  "max_elements",
  "pid",
  "query",
  "screenshot_out_file",
  "session",
  "window_id"
]);
var CUA_ACTION_CONTRACT_LIST = [
  {
    action: "capture",
    backendOperation: "get_window_state",
    backendRequired: ["pid", "window_id"],
    translatorAllowed: GET_WINDOW_STATE_ALLOWED,
    backendOnlyExcluded: [],
    forced: { include_screenshot: true },
    acceptsSnapshotTargeting: false
  },
  {
    // Deliberately shares capture's translator: 0.19.3 has no `screenshot` op.
    action: "screenshot",
    backendOperation: "get_window_state",
    backendRequired: ["pid", "window_id"],
    translatorAllowed: GET_WINDOW_STATE_ALLOWED,
    backendOnlyExcluded: [],
    forced: { include_screenshot: true },
    acceptsSnapshotTargeting: false
  },
  {
    action: "list_apps",
    backendOperation: "list_apps",
    backendRequired: [],
    translatorAllowed: [],
    backendOnlyExcluded: [],
    acceptsSnapshotTargeting: false
  },
  {
    action: "list_windows",
    backendOperation: "list_windows",
    backendRequired: [],
    translatorAllowed: ["pid", "on_screen_only"],
    backendOnlyExcluded: [],
    acceptsSnapshotTargeting: false
  },
  {
    action: "click",
    backendOperation: "click",
    backendRequired: [],
    translatorAllowed: [
      "button",
      "count",
      "debug_image_out",
      "delivery_mode",
      "element_index",
      "element_token",
      "from_zoom",
      "modifier",
      "pid",
      "scope",
      "session",
      "snapshot_id",
      "window_id",
      "x",
      "y"
    ],
    // Real 0.19.3 click has an optional backend `action: string`; it collides
    // with our public routing discriminator and must never be forwarded.
    backendOnlyExcluded: ["action"],
    pixelPairs: [["x", "y"]],
    acceptsSnapshotTargeting: true
  },
  {
    action: "double_click",
    backendOperation: "double_click",
    backendRequired: ["pid"],
    translatorAllowed: [
      "delivery_mode",
      "element_index",
      "element_token",
      "pid",
      "session",
      "snapshot_id",
      "window_id",
      "x",
      "y"
    ],
    backendOnlyExcluded: [],
    pixelPairs: [["x", "y"]],
    acceptsSnapshotTargeting: true
  },
  {
    action: "right_click",
    backendOperation: "right_click",
    backendRequired: ["pid"],
    translatorAllowed: [
      "delivery_mode",
      "element_index",
      "element_token",
      "modifier",
      "pid",
      "session",
      "snapshot_id",
      "window_id",
      "x",
      "y"
    ],
    backendOnlyExcluded: [],
    pixelPairs: [["x", "y"]],
    acceptsSnapshotTargeting: true
  },
  {
    action: "middle_click",
    backendOperation: "click",
    backendRequired: [],
    translatorAllowed: [
      "button",
      "count",
      "delivery_mode",
      "element_index",
      "element_token",
      "modifier",
      "pid",
      "scope",
      "session",
      "snapshot_id",
      "window_id",
      "x",
      "y"
    ],
    backendOnlyExcluded: ["action"],
    forced: { button: "middle" },
    pixelPairs: [["x", "y"]],
    acceptsSnapshotTargeting: true
  },
  {
    action: "drag",
    backendOperation: "drag",
    backendRequired: ["from_x", "from_y", "to_x", "to_y"],
    translatorAllowed: [
      "button",
      "delivery_mode",
      "duration_ms",
      "from_x",
      "from_y",
      "from_zoom",
      "modifier",
      "pid",
      "scope",
      "session",
      "steps",
      "to_x",
      "to_y",
      "window_id"
    ],
    backendOnlyExcluded: [],
    renames: { x: "from_x", y: "from_y" },
    pixelPairs: [["from_x", "from_y"], ["to_x", "to_y"]],
    acceptsSnapshotTargeting: false
  },
  {
    action: "scroll",
    backendOperation: "scroll",
    backendRequired: ["direction"],
    translatorAllowed: [
      "amount",
      "by",
      "delivery_mode",
      "direction",
      "element_index",
      "element_token",
      "pid",
      "scope",
      "session",
      "snapshot_id",
      "window_id",
      "x",
      "y"
    ],
    backendOnlyExcluded: [],
    renames: { pages: "amount" },
    pixelPairs: [["x", "y"]],
    acceptsSnapshotTargeting: true
  },
  {
    action: "type",
    backendOperation: "type_text",
    backendRequired: ["text"],
    translatorAllowed: [
      "delay_ms",
      "delivery_mode",
      "element_index",
      "element_token",
      "pid",
      "scope",
      "session",
      "snapshot_id",
      "text",
      "window_id",
      "x",
      "y"
    ],
    backendOnlyExcluded: [],
    pixelPairs: [["x", "y"]],
    acceptsSnapshotTargeting: true
  },
  {
    action: "key",
    backendOperation: "press_key",
    backendRequired: ["key"],
    translatorAllowed: [
      "delivery_mode",
      "element_index",
      "element_token",
      "key",
      "modifiers",
      "pid",
      "scope",
      "session",
      "snapshot_id",
      "window_id",
      "x",
      "y"
    ],
    backendOnlyExcluded: [],
    pixelPairs: [["x", "y"]],
    acceptsSnapshotTargeting: true
  },
  {
    action: "set_value",
    backendOperation: "set_value",
    backendRequired: ["pid", "value"],
    translatorAllowed: [
      "element_index",
      "element_token",
      "pid",
      "session",
      "snapshot_id",
      "value",
      "window_id"
    ],
    backendOnlyExcluded: [],
    // set_value has no pixel path at all.
    acceptsSnapshotTargeting: true
  }
];
for (const contract2 of CUA_ACTION_CONTRACT_LIST) {
  Object.freeze(contract2.backendRequired);
  Object.freeze(contract2.translatorAllowed);
  Object.freeze(contract2.backendOnlyExcluded);
  if (contract2.forced) Object.freeze(contract2.forced);
  if (contract2.renames) Object.freeze(contract2.renames);
  if (contract2.pixelPairs) {
    for (const pair2 of contract2.pixelPairs) Object.freeze(pair2);
    Object.freeze(contract2.pixelPairs);
  }
  Object.freeze(contract2);
}
var CUA_ACTION_CONTRACTS = Object.freeze(CUA_ACTION_CONTRACT_LIST);
var MACOS_CUA_ABI_PROFILE = Object.freeze({
  id: "macos-0.19.3",
  platform: "darwin",
  contracts: CUA_ACTION_CONTRACTS,
  absentOperations: Object.freeze(["screenshot", "middle_click"]),
  snapshotIdPattern: Object.freeze(SNAPSHOT_ID_PATTERN)
});
var WRAPPER_ONLY_FIELDS = Object.freeze([
  "action",
  "app",
  "capture_after",
  "pages",
  "javascript"
]);
var InvalidComputerUseInputError = class extends Error {
  code = "invalid_computer_use_input";
  constructor(detail) {
    super(`invalid_computer_use_input: ${detail}`);
    this.name = "InvalidComputerUseInputError";
  }
};
function contractFor(action, profile = MACOS_CUA_ABI_PROFILE) {
  const found = profile.contracts.find((c) => c.action === action);
  if (!found) throw new InvalidComputerUseInputError(`unsupported action "${action}"`);
  return found;
}
function normalizeIdentifier(field, value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new InvalidComputerUseInputError(`${field} must be a safe integer`);
    }
    return value;
  }
  if (field === "pid") {
    throw new InvalidComputerUseInputError("pid must be a number, not a string");
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new InvalidComputerUseInputError(`${field} overflows a safe integer`);
    }
    return parsed;
  }
  throw new InvalidComputerUseInputError(`${field} must be an integer or a decimal numeric string`);
}
function translateCuaAction(action, publicInput, profile = MACOS_CUA_ABI_PROFILE) {
  const contract2 = contractFor(action, profile);
  if ("javascript" in publicInput) {
    throw new InvalidComputerUseInputError("javascript is not supported by cua-driver 0.19.3");
  }
  const renamed = {};
  for (const [key, value] of Object.entries(publicInput)) {
    if (value === void 0) continue;
    if (WRAPPER_ONLY_FIELDS.includes(key) && !(contract2.renames && key in contract2.renames)) continue;
    const target = contract2.renames?.[key] ?? key;
    renamed[target] = value;
  }
  const output = {};
  for (const field of contract2.translatorAllowed) {
    if (!(field in renamed)) continue;
    const value = renamed[field];
    const expectedProperty = profile.expectedProperties?.[contract2.backendOperation]?.[field];
    if (expectedProperty && !IDENTIFIER_FIELDS.includes(field)) {
      const validType = expectedProperty.type === "integer" ? typeof value === "number" && Number.isSafeInteger(value) : expectedProperty.type === "number" ? typeof value === "number" && Number.isFinite(value) : expectedProperty.type === "array" ? Array.isArray(value) && value.every((item) => typeof item === "string") : typeof value === expectedProperty.type;
      if (!validType || expectedProperty.enum && !expectedProperty.enum.includes(value)) {
        throw new InvalidComputerUseInputError(`${field} does not match the frozen ${profile.id} contract`);
      }
    }
    if (IDENTIFIER_FIELDS.includes(field)) {
      output[field] = normalizeIdentifier(field, value);
      if (profile.platform === "win32" && field !== "element_index" && output[field] <= 0) {
        throw new InvalidComputerUseInputError(`${field} must be positive`);
      }
      continue;
    }
    if (field === "snapshot_id") {
      if (typeof value !== "string" || !profile.snapshotIdPattern.test(value)) {
        throw new InvalidComputerUseInputError(`snapshot_id must match ${profile.snapshotIdPattern.source}`);
      }
      output[field] = value;
      continue;
    }
    if (field === "element_token" && typeof value !== "string") {
      throw new InvalidComputerUseInputError("element_token must be a string");
    }
    output[field] = value;
  }
  for (const excluded of contract2.backendOnlyExcluded) {
    delete output[excluded];
  }
  for (const [field, value] of Object.entries(contract2.defaults ?? {})) {
    if (!(field in output)) output[field] = value;
  }
  Object.assign(output, contract2.forced ?? {});
  for (const [a, b] of contract2.pixelPairs ?? []) {
    const hasA = a in output;
    const hasB = b in output;
    if (hasA !== hasB) {
      throw new InvalidComputerUseInputError(`${a}/${b} must be provided together`);
    }
  }
  if ("element_index" in output) {
    if (!contract2.acceptsSnapshotTargeting) {
      throw new InvalidComputerUseInputError(`${action} does not accept element_index`);
    }
    if (!("snapshot_id" in output)) {
      throw new InvalidComputerUseInputError("element_index requires a matching snapshot_id");
    }
    if (!("window_id" in output)) {
      throw new InvalidComputerUseInputError("element_index requires window_id");
    }
  }
  const tokenOnly = "element_token" in output;
  for (const field of contract2.backendRequired) {
    if (field in output) continue;
    if (tokenOnly && field === "window_id") continue;
    throw new InvalidComputerUseInputError(`${contract2.backendOperation} requires ${field}`);
  }
  return { operation: contract2.backendOperation, input: output };
}
function verifyBackendAbi(catalog, profile = MACOS_CUA_ABI_PROFILE) {
  const problems = [];
  const byName = new Map(catalog.map((op) => [op.name, op]));
  for (const contract2 of profile.contracts) {
    const op = byName.get(contract2.backendOperation);
    if (!op) {
      problems.push(`missing backend operation ${contract2.backendOperation} for action ${contract2.action}`);
      continue;
    }
    const required = [...op.required].sort();
    const expected = [...contract2.backendRequired].sort();
    if (JSON.stringify(required) !== JSON.stringify(expected)) {
      problems.push(
        `${contract2.backendOperation} required set is [${required.join(",")}], expected [${expected.join(",")}]`
      );
    }
    for (const field of contract2.translatorAllowed) {
      if (!(field in op.properties)) {
        problems.push(`${contract2.backendOperation} has no property ${field}`);
        continue;
      }
      const expectedProperty = profile.expectedProperties?.[contract2.backendOperation]?.[field];
      if (expectedProperty && (op.properties[field].type !== expectedProperty.type || JSON.stringify(op.properties[field].enum) !== JSON.stringify(expectedProperty.enum))) {
        problems.push(`${contract2.backendOperation}.${field} type/enum drifted from ${profile.id}`);
      }
    }
    for (const excluded of contract2.backendOnlyExcluded) {
      const prop = op.properties[excluded];
      if (!prop) {
        problems.push(`${contract2.backendOperation} lost backend-only property ${excluded}`);
        continue;
      }
      if (prop.type !== "string" || prop.enum !== void 0) {
        problems.push(`${contract2.backendOperation}.${excluded} must stay an enum-free string`);
      }
    }
  }
  for (const absent of profile.absentOperations) {
    if (byName.has(absent)) {
      problems.push(`catalog unexpectedly exposes ${absent}; revisit the alias contract`);
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, code: "activation_failed", problems };
}

// src/platform/mcp/cua-runtime-failure.ts
var AUTHORIZATION_PATTERNS = [
  /permission\s+(?:denied|missing|required)/i,
  /approval\s+(?:denied|required|missing)/i,
  /authorization[^\n]*(?:denied|revoked|expired|invalid)/i,
  /policy[^\n]*(?:denied|revoked|disabled|invalid)/i,
  /disabled\s+by\s+(?:the\s+)?user/i
];
var SESSION_ENDED_PATTERNS = [
  /session\s+['"][^'"]+['"]\s+has\s+ended/i,
  /call\s+start_session[^\n]*\brevive\b/i
];
var TRANSPORT_CLOSED_PATTERNS = [
  /\btransport\s+(?:is\s+)?closed\b/i,
  /\bconnection\s+(?:is\s+)?closed\b/i,
  /\bbroken\s+pipe\b/i,
  /\bepipe\b/i,
  /\beconnreset\b/i
];
function messageFromFailure(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (!value || typeof value !== "object") return null;
  const result = value;
  if ("isError" in result && result.isError !== true) return null;
  if (typeof result.summary === "string" && result.summary) return result.summary;
  if (typeof result.text === "string" && result.text) return result.text;
  if (typeof result.message === "string" && result.message) return result.message;
  return null;
}
function classifyCuaRuntimeFailure(value) {
  const message = messageFromFailure(value);
  if (!message) return null;
  if (AUTHORIZATION_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: "authorization_denied", message };
  }
  const structured = value && typeof value === "object" ? value.structuredContent : void 0;
  const refusal = structured && typeof structured === "object" ? structured.refusal : void 0;
  if (refusal?.code === "session_ended") return { kind: "session_ended", message };
  if (SESSION_ENDED_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: "session_ended", message };
  }
  if (TRANSPORT_CLOSED_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: "transport_closed", message };
  }
  const normalized = message.toLowerCase();
  const mentionsCuaSocket = normalized.includes("cua-driver.sock");
  const daemonUnreachable = normalized.includes("cua-driver daemon not reachable") || mentionsCuaSocket && normalized.includes("daemon not reachable") || mentionsCuaSocket && normalized.includes("connect enoent") || mentionsCuaSocket && normalized.includes("econnrefused");
  return daemonUnreachable ? { kind: "daemon_unreachable", message } : null;
}
var OBSERVATION_FIELDS = Object.freeze({
  list_apps: Object.freeze(["session"]),
  list_windows: Object.freeze(["pid", "on_screen_only", "session"]),
  get_window_state: Object.freeze([
    "pid",
    "window_id",
    "capture_mode",
    "include_screenshot",
    "max_depth",
    "max_elements",
    "query",
    "session"
  ])
});
function isReplaySafeCuaCall(operation, input) {
  const allowed = Object.hasOwn(OBSERVATION_FIELDS, operation) ? OBSERVATION_FIELDS[operation] : void 0;
  return Boolean(allowed && Object.keys(input).every((field) => allowed.includes(field)));
}

// src/ai/tools/computer-use.ts
var DANGEROUS_KEY_PATTERNS = [
  /^cmd\+shift\+q$/i,
  /^cmd\+option\+shift\+q$/i,
  /^cmd\+ctrl\+q$/i,
  /^cmd\+shift\+backspace$/i,
  /^cmd\+option\+backspace$/i
];
var DANGEROUS_TEXT_PATTERNS = [
  /\bcurl\b[\s\S]*\|\s*(?:bash|sh)\b/i,
  /\bwget\b[\s\S]*\|\s*(?:bash|sh)\b/i,
  /\brm\s+-[^\n]*[rf][^\n]*\s+\/(?:\s|$)/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/
];
function createComputerUseTool(backend, abiProfile = MACOS_CUA_ABI_PROFILE) {
  const PUBLIC_CUA_ACTIONS = abiProfile.contracts.map((c) => c.action);
  const repeatedRecoverableErrors = /* @__PURE__ */ new Set();
  let lastErrorGeneration;
  return {
    permission: "write",
    definition: {
      name: "xiaok_computer_use",
      description: `Observe and operate local ${abiProfile.platform === "win32" ? "Windows" : "macOS"} apps through CUA Driver with Xiaok safety checks. Session revival and transport reconnection are owned internally by Xiaok; never search for or call start_session or raw cua-driver commands. If an error has waitForUserAction=true, stop and wait for that user action. If a reobserve-required error has waitForUserAction=false, first capture the current target UI again, then decide whether the interrupted mutation still needs to be retried. On Windows, open a user-authorized HTTP/HTTPS webpage with open_url, then list_windows and capture the browser to verify it. Never use shell start to open a browser, and never blindly repeat a launch after timeout or interruption. Windows mutations default to background. An explicit foreground retry requires COMPUTER_USE_BACKGROUND_UNAVAILABLE for that exact target/operation (and button/count for clicks) and another fresh capture; never switch focus preemptively. Windows double/right clicks without observed web content refuse background pen input before dispatch; capture again before explicitly requesting foreground mouse input. Windows middle clicks refuse the background route before input because the pinned driver may invoke the primary action instead. An observed Windows text editor may refuse background pen drag before sending input so that text selection uses an explicitly authorized foreground mouse drag. Windows mutations require a fresh capture, explicit pid + window_id, and tokens/indices from that exact host snapshot. Never fall back to shell screenshot, osascript, cliclick, open, or cua-driver commands.`,
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: PUBLIC_CUA_ACTIONS,
            description: "Computer-use action to run."
          },
          app: { type: "string" },
          pid: { type: abiProfile.platform === "win32" ? "integer" : "number" },
          window_id: { type: abiProfile.platform === "win32" ? "integer" : "string" },
          element_index: { type: abiProfile.platform === "win32" ? "integer" : "string" },
          x: { type: "number" },
          y: { type: "number" },
          to_x: { type: "number" },
          to_y: { type: "number" },
          direction: { type: "string" },
          pages: { type: "number" },
          text: { type: "string" },
          key: { type: "string" },
          value: { type: "string" },
          on_screen_only: { type: "boolean" },
          query: { type: "string" },
          ...abiProfile.platform === "win32" ? {
            url: { type: "string", description: "One user-authorized HTTP/HTTPS URL to open in the default browser. Then list_windows and capture; never use shell start." },
            snapshot_id: { type: "string", description: "Host snapshot identity returned by this generation of capture. Required with element_index." },
            element_token: { type: "string", description: "Host element token from the latest capture of this pid and window_id." },
            capture_id: { type: "string", description: "Host capture identity from the latest capture of this target." },
            delivery_mode: { type: "string", enum: ["background", "foreground"] },
            button: { type: "string", enum: ["left", "right", "middle"] },
            count: { type: "integer", minimum: 1, maximum: 3 },
            by: { type: "string", enum: ["line", "page"] },
            duration_ms: { type: "integer", minimum: 0 },
            steps: { type: "integer", minimum: 1 },
            delay_ms: { type: "integer", minimum: 0 },
            include_accessibility_tree: { type: "boolean" },
            max_depth: { type: "integer", minimum: 1 },
            max_elements: { type: "integer", minimum: 1 },
            max_dimension: { type: "integer", minimum: 1 },
            max_image_dimension: { type: "integer", minimum: 0 },
            timeout_ms: { type: "integer", minimum: 100, maximum: 12e4 },
            modifier: { type: "array", items: { type: "string" } },
            modifiers: { type: "array", items: { type: "string" } }
          } : { javascript: { type: "string" }, screenshot_out_file: { type: "string" } },
          capture_after: { type: "boolean" }
        },
        required: ["action"],
        additionalProperties: abiProfile.platform !== "win32"
      }
    },
    async execute(input, context) {
      const options = context?.signal ? { signal: context.signal } : void 0;
      options?.signal?.throwIfAborted();
      const lease = backend.acquireInvocation?.();
      if (lease?.generation !== lastErrorGeneration) {
        repeatedRecoverableErrors.clear();
        lastErrorGeneration = lease?.generation;
      }
      const returnRecoverableError = (error2, notifyBackend = false) => {
        if (notifyBackend && error2.notifyBackend !== false) {
          try {
            backend.onRecoverableError?.(error2);
          } catch {
          }
        }
        const remember = error2.remember !== false;
        const repeated = remember && repeatedRecoverableErrors.has(error2.code);
        if (remember) repeatedRecoverableErrors.add(error2.code);
        const retryable = error2.retryable ?? !repeated;
        const waitForUserAction = error2.waitForUserAction ?? true;
        return JSON.stringify({
          ok: false,
          code: error2.code,
          message: error2.message,
          retryable,
          waitForUserAction,
          ...repeated ? { repeated: true } : {},
          ...!repeated && waitForUserAction && error2.userAction ? { userAction: error2.userAction } : {},
          ...error2.nextAction ? { nextAction: error2.nextAction } : {}
        });
      };
      const unavailable = backend.getUnavailableError?.();
      if (unavailable) {
        return returnRecoverableError(unavailable);
      }
      const action = typeof input.action === "string" ? input.action : "";
      if (!PUBLIC_CUA_ACTIONS.includes(action)) {
        return `Error: unsupported computer-use action: ${String(input.action)}`;
      }
      const targetBackend = lease?.backend ?? backend;
      const invocationProfile = targetBackend.abiProfile ?? abiProfile;
      if (invocationProfile.id !== abiProfile.id) return returnRecoverableError({ code: "COMPUTER_USE_WRAPPER_NOT_READY", message: "Computer Use \u63A5\u53E3\u7248\u672C\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u542F\u7528\u3002", retryable: false });
      const assertGeneration = () => {
        if (lease && !lease.isCurrent()) {
          throw Object.assign(new Error("Computer Use connection changed; observe again."), { code: "COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED" });
        }
      };
      const invocationBackend = {
        ...targetBackend,
        async callToolResult(name, args, callOptions) {
          assertGeneration();
          const result2 = await targetBackend.callToolResult(name, args, callOptions);
          assertGeneration();
          if (targetBackend.requiresImageInput && name === "get_window_state" && !result2.isError) {
            const observation2 = result2.structuredContent;
            for (const field of ["pid", "window_id"]) {
              const requested = args[field];
              if (typeof requested !== "number" || !Number.isSafeInteger(requested) || requested <= 0 || !observation2 || observation2[field] !== requested) throw new Error("COMPUTER_USE_OBSERVATION_TARGET_MISMATCH");
            }
          }
          return result2;
        }
      };
      if (targetBackend.requiresImageInput && !["list_apps", "list_windows"].includes(action) && (context?.modelSupportsImageInput !== true || !context.emitToolImage)) {
        return returnRecoverableError({ code: "COMPUTER_USE_MODEL_IMAGE_DISABLED", message: "\u5F53\u524D\u4F1A\u8BDD\u6A21\u578B\u6CA1\u6709\u7ECF\u8FC7\u786E\u8BA4\u7684\u56FE\u7247\u8F93\u5165\u80FD\u529B\uFF0C\u8BF7\u5207\u6362\u5230\u652F\u6301\u56FE\u7247\u7684\u6A21\u578B\u3002", retryable: false, waitForUserAction: true, remember: false });
      }
      const images = [];
      const blocked = checkBlockedInput(action, input);
      if (blocked) return blocked;
      let prepared;
      try {
        prepared = await buildActionInput(invocationBackend, action, input, options);
        options?.signal?.throwIfAborted();
      } catch (error2) {
        options?.signal?.throwIfAborted();
        const recoverable = classifyRecoverableComputerUseError(error2);
        if (recoverable) return returnRecoverableError(recoverable, true);
        throw error2;
      }
      if (typeof prepared === "string") {
        const recoverable = classifyRecoverableComputerUseError(prepared);
        if (recoverable) return returnRecoverableError(recoverable, true);
        return prepared;
      }
      let translated;
      try {
        translated = translateCuaAction(action, targetBackend.prepareActionInput?.(action, prepared) ?? prepared, invocationProfile);
      } catch (error2) {
        if (error2 instanceof InvalidComputerUseInputError) return `Error: ${error2.message}`;
        const recoverable = classifyRecoverableComputerUseError(error2);
        if (recoverable) return returnRecoverableError(recoverable);
        throw error2;
      }
      let result;
      try {
        result = await callComputerUseBackend(invocationBackend, translated.operation, translated.input, options);
        options?.signal?.throwIfAborted();
      } catch (error2) {
        options?.signal?.throwIfAborted();
        const recoverable = classifyRecoverableComputerUseError(error2);
        if (recoverable) return returnRecoverableError(recoverable, true);
        throw error2;
      }
      if (result.isError) {
        const recoverable = classifyRecoverableComputerUseError(result);
        if (recoverable) return returnRecoverableError(recoverable, true);
        return `Error: ${result.summary || result.text || "computer-use action failed"}`;
      }
      const response = {
        ok: true,
        action,
        result: sanitizeToolResult(result)
      };
      if (targetBackend.requiresImageInput && ["capture", "screenshot"].includes(action)) images.push(...result.images);
      if (input.capture_after === true && action !== "capture" && action !== "screenshot" && action !== "list_apps" && action !== "list_windows") {
        const captureInput = await buildCaptureInput(invocationBackend, input, options);
        options?.signal?.throwIfAborted();
        if (typeof captureInput === "string") {
          const recoverable = classifyRecoverableComputerUseError(captureInput);
          if (recoverable) return returnRecoverableError(recoverable, true);
          response.captureAfter = { error: captureInput };
          return JSON.stringify(response);
        }
        const captureTranslated = translateCuaAction("capture", captureInput, invocationProfile);
        let capture;
        try {
          capture = await callComputerUseBackend(
            invocationBackend,
            captureTranslated.operation,
            captureTranslated.input,
            options
          );
          options?.signal?.throwIfAborted();
        } catch (error2) {
          options?.signal?.throwIfAborted();
          const recoverable = classifyRecoverableComputerUseError(error2);
          if (recoverable) return returnRecoverableError(recoverable, true);
          throw error2;
        }
        if (capture.isError) {
          const recoverable = classifyRecoverableComputerUseError(capture);
          if (recoverable) return returnRecoverableError(recoverable, true);
        }
        if (targetBackend.requiresImageInput && !capture.isError) images.push(...capture.images);
        response.captureAfter = sanitizeToolResult(capture);
      }
      options?.signal?.throwIfAborted();
      assertGeneration();
      for (const image of images) {
        if (!image.data || image.mimeType !== "image/png") throw new Error("COMPUTER_USE_IMAGE_INVALID");
        context.emitToolImage({ type: "image", source: { type: "base64", media_type: "image/png", data: image.data } });
      }
      return JSON.stringify(response);
    }
  };
}
async function callComputerUseBackend(backend, name, input, options) {
  options?.signal?.throwIfAborted();
  try {
    const result = await (options ? backend.callToolResult(name, input, options) : backend.callToolResult(name, input));
    options?.signal?.throwIfAborted();
    return result;
  } catch (error2) {
    options?.signal?.throwIfAborted();
    throw error2;
  }
}
function classifyRecoverableComputerUseError(value) {
  const code = readErrorCode(value);
  if (code === "background_unavailable" || code === "background_occluded") {
    return { code: "COMPUTER_USE_BACKGROUND_UNAVAILABLE", message: "\u5F53\u524D\u76EE\u6807\u7684\u540E\u53F0\u64CD\u4F5C\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u65B0\u89C2\u5BDF\u540E\u518D\u51B3\u5B9A\u662F\u5426\u663E\u5F0F\u9009\u62E9 foreground\u3002", waitForUserAction: false, retryable: true, notifyBackend: false, remember: false, nextAction: "capture" };
  }
  const nativeMessage = value && typeof value === "object" ? value.summary ?? value.text : void 0;
  if (code === "foreground_unavailable" || code === "tool_invocation_failed" && typeof nativeMessage === "string" && nativeMessage.startsWith("foreground_unavailable:")) return { code: "COMPUTER_USE_FOREGROUND_UNAVAILABLE", message: "Windows \u672A\u786E\u8BA4\u76EE\u6807\u7A97\u53E3\u6216\u63A7\u4EF6\u83B7\u5F97\u7126\u70B9\u3002\u8BF7\u68C0\u67E5\u76EE\u6807\u72B6\u6001\u540E\u91CD\u65B0\u89C2\u5BDF\uFF0C\u907F\u514D\u91CD\u590D\u53D1\u9001\u64CD\u4F5C\u3002", waitForUserAction: true, retryable: false, notifyBackend: false, remember: false };
  if (code === "background_uipi_blocked") return { code: "COMPUTER_USE_WINDOWS_TARGET_PERMISSION_DENIED", message: "Windows \u963B\u6B62\u4E86\u5411\u6B64\u76EE\u6807\u53D1\u9001\u8F93\u5165\uFF0C\u8BF7\u5C06\u76EE\u6807\u4E0E\u5C0FK\u8FD0\u884C\u5728\u76F8\u540C\u6743\u9650\u7EA7\u522B\u540E\u91CD\u65B0\u89C2\u5BDF\u3002", waitForUserAction: true, retryable: false, notifyBackend: false, remember: false };
  if (code === "COMPUTER_USE_WINDOW_AMBIGUOUS") {
    return { code, message: value instanceof Error ? value.message : "\u591A\u4E2A\u7A97\u53E3\u5339\u914D\uFF0C\u8BF7\u660E\u786E pid + window_id\u3002", waitForUserAction: false, retryable: true, notifyBackend: false, remember: false, nextAction: "list_windows" };
  }
  if (code === "COMPUTER_USE_REOBSERVE_REQUIRED" || code === "COMPUTER_USE_OBSERVATION_TARGET_MISMATCH" || code === "COMPUTER_USE_OBSERVATION_INVALID") {
    return {
      code,
      message: "\u76EE\u6807\u5C1A\u672A\u89C2\u5BDF\u3001\u5FEB\u7167\u5DF2\u8FC7\u671F\u6216\u89C2\u5BDF\u7ED3\u679C\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0 capture \u540C\u4E00 pid \u4E0E window_id \u540E\u518D\u64CD\u4F5C\u3002",
      waitForUserAction: false,
      retryable: true,
      notifyBackend: false,
      remember: false,
      nextAction: "capture"
    };
  }
  if (code === "COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED") {
    return {
      code,
      message: "Computer Use \u8FDE\u63A5\u5DF2\u6062\u590D\u3002\u8BF7\u5148\u91CD\u65B0\u89C2\u5BDF\u5F53\u524D\u754C\u9762\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u91CD\u8BD5\u521A\u624D\u7684\u64CD\u4F5C\u3002",
      waitForUserAction: false,
      retryable: true,
      notifyBackend: false,
      remember: false,
      nextAction: "observe"
    };
  }
  const runtimeFailure = classifyCuaRuntimeFailure(value);
  if (!runtimeFailure || runtimeFailure.kind === "authorization_denied") {
    if (code !== "COMPUTER_USE_CONNECTION_RECOVERY_FAILED") return null;
  }
  return {
    code: "COMPUTER_USE_MCP_CONNECT_TIMEOUT",
    message: "CUA Driver \u540E\u53F0\u670D\u52A1\u4E0D\u53EF\u8FBE\uFF0C\u8BF7\u5728\u5C0FK\u8BBE\u7F6E\u91CC\u91CD\u65B0\u8FDE\u63A5 Computer Use\u3002",
    userAction: { type: "reconnect_computer_use", label: "\u91CD\u65B0\u8FDE\u63A5" }
  };
}
function readErrorCode(value) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  const code = record.code ?? record.structuredContent?.code ?? record.structuredContent?.error?.code;
  return typeof code === "string" ? code : null;
}
function checkBlockedInput(action, input) {
  if (action === "open_url" && (input.capture_after === true || Object.keys(input).some((field) => !["action", "url", "capture_after"].includes(field)))) {
    return "Error: open_url accepts only url; use list_windows and capture after opening, not capture_after or executable arguments";
  }
  if (action === "type") {
    const text = typeof input.text === "string" ? input.text : "";
    if (DANGEROUS_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
      return "Error: blocked dangerous computer-use text input";
    }
  }
  if (action === "key") {
    const key = typeof input.key === "string" ? input.key.trim() : "";
    if (DANGEROUS_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      return "Error: blocked dangerous computer-use key combo";
    }
  }
  return null;
}
async function buildActionInput(backend, action, input, options) {
  if (action === "capture") {
    return buildCaptureInput(backend, input, options);
  }
  if (action === "screenshot") {
    return buildScreenshotInput(backend, input, options);
  }
  if (action === "list_windows") {
    return buildListWindowsInput(input);
  }
  return buildCuaInput(input);
}
function buildCuaInput(input) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "action" || key === "capture_after") continue;
    if (value === void 0 || value === null || value === "") continue;
    output[key] = value;
  }
  return output;
}
function buildListWindowsInput(input) {
  const output = {};
  const pid = normalizeInteger(input.pid);
  if (pid !== null) {
    output.pid = pid;
  }
  if (typeof input.on_screen_only === "boolean") {
    output.on_screen_only = input.on_screen_only;
  }
  return output;
}
async function buildCaptureInput(backend, input, options) {
  const direct = buildDirectWindowStateInput(input);
  if (direct) return direct;
  const app = typeof input.app === "string" ? input.app.trim() : "";
  if (!app) {
    return "Error: capture requires pid + window_id, or an app name that can be resolved through list_windows";
  }
  const windows = await callComputerUseBackend(backend, "list_windows", { on_screen_only: true }, options);
  if (windows.isError) {
    return `Error: ${windows.summary || windows.text || "list_windows failed before capture"}`;
  }
  const candidate = selectWindowForApp(windows.structuredContent, app, backend.abiProfile?.platform === "win32");
  if (!candidate) {
    return `Error: no visible CUA window found for app: ${app}`;
  }
  return {
    pid: candidate.pid,
    window_id: candidate.windowId,
    ...pickWindowStateOptions(input)
  };
}
async function buildScreenshotInput(backend, input, options) {
  const direct = buildDirectWindowAddressInput(input);
  if (direct) return direct;
  const app = typeof input.app === "string" ? input.app.trim() : "";
  if (!app) {
    return "Error: screenshot requires pid + window_id, or an app name that can be resolved through list_windows";
  }
  const windows = await callComputerUseBackend(backend, "list_windows", { on_screen_only: true }, options);
  if (windows.isError) {
    return `Error: ${windows.summary || windows.text || "list_windows failed before screenshot"}`;
  }
  const candidate = selectWindowForApp(windows.structuredContent, app, backend.abiProfile?.platform === "win32");
  if (!candidate) {
    return `Error: no visible CUA window found for app: ${app}`;
  }
  return {
    pid: candidate.pid,
    window_id: candidate.windowId
  };
}
function buildDirectWindowStateInput(input) {
  const direct = buildDirectWindowAddressInput(input);
  if (!direct) return null;
  return {
    ...direct,
    ...pickWindowStateOptions(input)
  };
}
function buildDirectWindowAddressInput(input) {
  const pid = normalizeInteger(input.pid);
  const windowId = normalizeInteger(input.window_id);
  if (pid === null || windowId === null) return null;
  return {
    pid,
    window_id: windowId
  };
}
function pickWindowStateOptions(input) {
  const output = {};
  for (const key of ["query", "javascript", "screenshot_out_file"]) {
    if (typeof input[key] === "string" && input[key].trim()) {
      output[key] = input[key];
    }
  }
  for (const key of ["include_accessibility_tree", "max_depth", "max_elements", "max_dimension", "max_image_dimension", "timeout_ms"]) {
    if (input[key] !== void 0) output[key] = input[key];
  }
  return output;
}
function selectWindowForApp(structuredContent, app, rejectAmbiguous = false) {
  const windows = extractWindows(structuredContent);
  const normalizedApp = normalizeName(app);
  const candidates = windows.map(normalizeWindowRecord).filter((window) => window !== null).filter((window) => {
    const appName = normalizeName(window.appName);
    return Boolean(appName) && (appName === normalizedApp || appName.includes(normalizedApp) || normalizedApp.includes(appName));
  });
  if (rejectAmbiguous && candidates.length > 1) {
    throw Object.assign(new Error(`\u591A\u4E2A\u7A97\u53E3\u5339\u914D ${app}\uFF0C\u8BF7\u660E\u786E pid + window_id\uFF1A${JSON.stringify(candidates.slice(0, 8).map((window) => ({ pid: window.pid, window_id: window.windowId, title: window.title })))}`), { code: "COMPUTER_USE_WINDOW_AMBIGUOUS" });
  }
  const selected = candidates.find((window) => window.isOnScreen !== false) ?? candidates[0];
  if (!selected) return null;
  return { pid: selected.pid, windowId: selected.windowId };
}
function extractWindows(structuredContent) {
  if (!structuredContent || typeof structuredContent !== "object") return [];
  const windows = structuredContent.windows;
  return Array.isArray(windows) ? windows : [];
}
function normalizeWindowRecord(record) {
  if (!record || typeof record !== "object") return null;
  const value = record;
  const pid = normalizeInteger(value.pid);
  const windowId = normalizeInteger(value.window_id);
  const appName = readFirstString(value, ["app_name", "app", "name"]);
  if (pid === null || windowId === null || !appName) return null;
  return {
    appName,
    title: readFirstString(value, ["title", "window_title"]).slice(0, 200),
    pid,
    windowId,
    ...typeof value.is_on_screen === "boolean" ? { isOnScreen: value.is_on_screen } : {}
  };
}
function readFirstString(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}
function normalizeInteger(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}
function normalizeName(value) {
  return value.trim().toLowerCase();
}
function sanitizeToolResult(result) {
  return {
    text: result.text,
    summary: result.summary,
    images: result.images.map((image) => ({
      mimeType: image.mimeType,
      ...image.filePath ? { filePath: image.filePath } : {},
      ...image.description ? { description: image.description } : {},
      ...image.data ? { data: "[image data omitted]" } : {}
    })),
    ...result.structuredContent !== void 0 ? { structuredContent: result.structuredContent } : {}
  };
}

// src/ai/mcp/runtime/client.ts
function normalizeMcpRuntimeToolResult(result) {
  const value = isRecord(result) ? result : {};
  const content = Array.isArray(value.content) ? value.content : [];
  const textParts = [];
  const images = [];
  for (const entry of content) {
    if (!isRecord(entry)) continue;
    if (entry.type === "text" && typeof entry.text === "string") {
      textParts.push(entry.text);
      continue;
    }
    if (entry.type === "image") {
      const mimeType = typeof entry.mimeType === "string" ? entry.mimeType : typeof entry.mime_type === "string" ? entry.mime_type : "image/png";
      images.push({
        mimeType,
        ...typeof entry.data === "string" ? { data: entry.data } : {},
        ...typeof entry.filePath === "string" ? { filePath: entry.filePath } : {},
        ...typeof entry.description === "string" ? { description: entry.description } : {}
      });
    }
  }
  const text = textParts.join("\n");
  return {
    text,
    images,
    ...Object.prototype.hasOwnProperty.call(value, "structuredContent") ? { structuredContent: value.structuredContent } : {},
    isError: value.isError === true,
    summary: text || (images.length > 0 ? `[${images.length} image${images.length === 1 ? "" : "s"}]` : "")
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

// src/platform/mcp/cua-connection-manager.ts
var DEFAULT_CONNECT_TIMEOUT_MS = 15e3;
var CuaConnectionManager = class {
  _state = "idle";
  _connection = null;
  _connectPromise = null;
  _epoch = 0;
  _generation = 0;
  _isReplaySafeCall;
  _pendingCloses = /* @__PURE__ */ new Set();
  _revivePromises = /* @__PURE__ */ new Map();
  _factory;
  _connectTimeoutMs;
  constructor(factory, options = {}) {
    this._factory = factory;
    this._connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this._isReplaySafeCall = options.isReplaySafeCall ?? isReplaySafeCuaCall;
    if (options.initialConnection) {
      this._connection = options.initialConnection;
      this._state = "connected";
      this._generation += 1;
    }
  }
  get state() {
    return this._state;
  }
  get generation() {
    return this._generation;
  }
  async callToolResult(name, input, options) {
    options?.signal?.throwIfAborted();
    try {
      const epoch = this._epoch;
      const connection = await this._ensureConnected(epoch);
      options?.signal?.throwIfAborted();
      this._assertEpoch(epoch);
      const first = await invoke(connection, name, input, options);
      options?.signal?.throwIfAborted();
      const failure = classifyCuaRuntimeFailure(first.ok ? first.result : first.error);
      if (!failure || failure.kind === "authorization_denied") {
        return unwrap(first);
      }
      let recoveredConnection = connection;
      if (failure.kind === "session_ended") {
        const revive = await this._reviveSession(connection, input, epoch);
        options?.signal?.throwIfAborted();
        this._assertEpoch(epoch);
        const reviveFailure = classifyCuaRuntimeFailure(revive.ok ? revive.result : revive.error);
        if (reviveFailure?.kind === "authorization_denied") return unwrap(revive);
        if (!revive.ok || revive.result.isError) {
          recoveredConnection = await this._replaceConnection(connection, epoch);
        } else if (this._connection !== connection) {
          recoveredConnection = await this._ensureConnected(epoch);
        }
      } else {
        recoveredConnection = await this._replaceConnection(connection, epoch);
      }
      options?.signal?.throwIfAborted();
      this._assertEpoch(epoch);
      if (!this._isReplaySafeCall(name, input)) {
        throw new CuaConnectionReobserveRequiredError();
      }
      const retry = await invoke(recoveredConnection, name, input, options);
      options?.signal?.throwIfAborted();
      const retryFailure = classifyCuaRuntimeFailure(retry.ok ? retry.result : retry.error);
      if (retryFailure && retryFailure.kind !== "authorization_denied") {
        await this._invalidateConnection(recoveredConnection);
      }
      return unwrap(retry);
    } catch (error2) {
      options?.signal?.throwIfAborted();
      throw error2;
    }
  }
  async dispose() {
    this._epoch += 1;
    this._generation += 1;
    if (this._state === "idle") {
      await Promise.all(this._pendingCloses);
      return;
    }
    if (this._state === "connecting") {
      this._state = "closing";
      try {
        await this._connectPromise;
      } catch {
      }
      this._cleanup();
      await Promise.all(this._pendingCloses);
      return;
    }
    if (this._state === "connected" || this._state === "failed") {
      this._cleanup();
      await Promise.all(this._pendingCloses);
      return;
    }
    if (this._state === "closing") {
      await Promise.all(this._pendingCloses);
      return;
    }
  }
  _closeConnection(connection) {
    try {
      const pending = Promise.resolve(connection.dispose()).catch(() => void 0);
      this._pendingCloses.add(pending);
      void pending.finally(() => this._pendingCloses.delete(pending));
    } catch {
    }
  }
  _cleanup() {
    if (this._connection) {
      try {
        this._closeConnection(this._connection);
      } catch {
      }
      this._connection = null;
    }
    this._connectPromise = null;
    this._revivePromises.clear();
    this._state = "idle";
  }
  async _ensureConnected(epoch) {
    this._assertEpoch(epoch);
    if (this._state === "connected" && this._connection) {
      return this._connection;
    }
    if (this._state === "connecting" && this._connectPromise) {
      return this._connectPromise;
    }
    this._state = "connecting";
    this._connectPromise = this._doConnect();
    try {
      const connection = await this._connectPromise;
      if (epoch !== this._epoch) {
        this._closeConnection(connection);
        throw new Error("CUA connection cancelled during dispose");
      }
      this._connection = connection;
      this._generation += 1;
      this._state = "connected";
      return connection;
    } catch (error2) {
      if (epoch !== this._epoch) {
        this._state = "idle";
      } else {
        this._state = "failed";
      }
      this._connectPromise = null;
      throw error2;
    }
  }
  async _doConnect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error(`CUA connection timeout after ${this._connectTimeoutMs}ms`));
      }, this._connectTimeoutMs);
      this._factory().then((connection) => {
        if (settled) {
          this._closeConnection(connection);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(connection);
      }).catch((error2) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error2);
      });
    });
  }
  async _reviveSession(connection, originalInput, epoch) {
    this._assertEpoch(epoch);
    const session = normalizeSessionLabel(originalInput.session);
    const key = session ?? "<implicit>";
    const existing = this._revivePromises.get(key);
    if (existing) return existing;
    this._generation += 1;
    const promise = invoke(connection, "start_session", session ? { session } : {});
    this._revivePromises.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this._revivePromises.get(key) === promise) this._revivePromises.delete(key);
    }
  }
  async _replaceConnection(connection, epoch) {
    this._assertEpoch(epoch);
    await this._invalidateConnection(connection);
    try {
      return await this._ensureConnected(epoch);
    } catch (error2) {
      if (epoch !== this._epoch) throw error2;
      throw new CuaConnectionRecoveryFailedError(error2);
    }
  }
  async _invalidateConnection(connection) {
    if (this._connection !== connection) return false;
    this._generation += 1;
    try {
      this._closeConnection(connection);
    } catch {
    }
    this._connection = null;
    this._connectPromise = null;
    this._revivePromises.clear();
    this._state = "idle";
    await Promise.all(this._pendingCloses);
    return true;
  }
  _assertEpoch(epoch) {
    if (epoch !== this._epoch) {
      throw new Error("CUA connection recovery cancelled because the manager was disposed");
    }
  }
};
async function invoke(connection, name, input, options) {
  try {
    return { ok: true, result: await (options ? connection.callToolResult(name, input, options) : connection.callToolResult(name, input)) };
  } catch (error2) {
    return { ok: false, error: error2 };
  }
}
function unwrap(outcome) {
  if (outcome.ok) return outcome.result;
  throw outcome.error;
}
function normalizeSessionLabel(value) {
  if (typeof value !== "string") return null;
  const session = value.trim();
  if (!session || session.length > 128 || /[\u0000-\u001f\u007f]/.test(session)) return null;
  return session;
}
var CuaConnectionReobserveRequiredError = class extends Error {
  code = "COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED";
  constructor() {
    super("Computer Use connection recovered; re-observe before retrying the action");
    this.name = "CuaConnectionReobserveRequiredError";
  }
};
var CuaConnectionRecoveryFailedError = class extends Error {
  code = "COMPUTER_USE_CONNECTION_RECOVERY_FAILED";
  constructor(cause) {
    super("Computer Use connection recovery failed", { cause });
    this.name = "CuaConnectionRecoveryFailedError";
  }
};

// src/platform/computer-use/windows-cua-observation.ts
import { randomBytes } from "node:crypto";

// src/platform/computer-use/windows-cua-profile.ts
var types = Object.freeze({
  pid: "integer",
  window_id: "integer",
  max_depth: "integer",
  max_elements: "integer",
  max_dimension: "integer",
  max_image_dimension: "integer",
  timeout_ms: "integer",
  count: "integer",
  duration_ms: "integer",
  steps: "integer",
  delay_ms: "integer",
  amount: "integer",
  include_screenshot: "boolean",
  include_accessibility_tree: "boolean",
  on_screen_only: "boolean",
  x: "number",
  y: "number",
  from_x: "number",
  from_y: "number",
  to_x: "number",
  to_y: "number",
  modifier: "array",
  modifiers: "array",
  urls: "array",
  session: "string",
  query: "string",
  element_token: "string",
  capture_id: "string",
  button: "string",
  delivery_mode: "string",
  scope: "string",
  direction: "string",
  by: "string",
  text: "string",
  key: "string",
  value: "string"
});
var enums = Object.freeze({
  button: Object.freeze(["left", "right", "middle"]),
  delivery_mode: Object.freeze(["background", "foreground"]),
  scope: Object.freeze(["window", "desktop"]),
  direction: Object.freeze(["up", "down", "left", "right"]),
  by: Object.freeze(["line", "page"])
});
var windowFields = ["pid", "window_id", "element_token", "session", "delivery_mode"];
function contract(action, operation, required, allowed, extra = {}) {
  return Object.freeze({
    action,
    backendOperation: operation,
    backendRequired: Object.freeze(required),
    translatorAllowed: Object.freeze(allowed),
    backendOnlyExcluded: Object.freeze([]),
    acceptsSnapshotTargeting: false,
    ...extra
  });
}
var background = Object.freeze({ delivery_mode: "background" });
var windowScope = Object.freeze({ scope: "window" });
var pair = Object.freeze([Object.freeze(["x", "y"])]);
var observation = ["pid", "window_id", "include_screenshot", "include_accessibility_tree", "max_depth", "max_elements", "max_dimension", "max_image_dimension", "timeout_ms", "query", "session"];
var click = [...windowFields, "x", "y", "button", "count", "modifier", "scope", "capture_id"];
var contracts = Object.freeze([
  contract("capture", "get_window_state", ["pid", "window_id"], [...observation], { forced: Object.freeze({ include_screenshot: true }) }),
  contract("screenshot", "get_window_state", ["pid", "window_id"], [...observation], { forced: Object.freeze({ include_screenshot: true }) }),
  contract("list_apps", "list_apps", [], ["session"]),
  contract("list_windows", "list_windows", [], ["pid", "on_screen_only", "session"]),
  contract("open_url", "launch_app", [], ["urls"]),
  contract("click", "click", [], [...click], { defaults: background, forced: windowScope, pixelPairs: pair }),
  contract("middle_click", "click", [], [...click], { defaults: background, forced: Object.freeze({ ...windowScope, button: "middle" }), pixelPairs: pair }),
  contract("double_click", "double_click", ["pid"], [...windowFields, "x", "y", "modifier"], { defaults: background, pixelPairs: pair }),
  contract("right_click", "right_click", ["pid"], [...windowFields, "x", "y", "modifier"], { defaults: background, pixelPairs: pair }),
  contract("drag", "drag", ["from_x", "from_y", "to_x", "to_y"], ["pid", "window_id", "session", "delivery_mode", "scope", "from_x", "from_y", "to_x", "to_y", "button", "duration_ms", "steps", "modifier"], {
    defaults: background,
    forced: windowScope,
    renames: Object.freeze({ x: "from_x", y: "from_y" }),
    pixelPairs: Object.freeze([Object.freeze(["from_x", "from_y"]), Object.freeze(["to_x", "to_y"])])
  }),
  contract("scroll", "scroll", ["direction"], [...windowFields, "x", "y", "scope", "amount", "by", "direction"], { defaults: background, forced: windowScope, renames: Object.freeze({ pages: "amount" }), pixelPairs: pair }),
  contract("type", "type_text", ["text"], [...windowFields, "x", "y", "scope", "text", "delay_ms"], { defaults: background, forced: windowScope, pixelPairs: pair }),
  contract("key", "press_key", ["key"], [...windowFields, "x", "y", "scope", "key", "modifiers"], { defaults: background, forced: windowScope, pixelPairs: pair }),
  contract("set_value", "set_value", ["pid", "value"], [...windowFields, "value"], { defaults: background })
]);
var expectedProperties = {};
for (const c of contracts) {
  expectedProperties[c.backendOperation] = Object.freeze(Object.fromEntries(c.translatorAllowed.map((field) => [
    field,
    Object.freeze({ type: types[field], ...enums[field] ? { enum: enums[field] } : {} })
  ])));
}
var WINDOWS_CUA_ABI_PROFILE = Object.freeze({
  id: "windows-x64-0.31.0",
  platform: "win32",
  contracts,
  absentOperations: Object.freeze(["screenshot", "middle_click"]),
  snapshotIdPattern: Object.freeze(/^w[0-9a-f]{32}:s[0-9a-f]{8}$/),
  expectedProperties: Object.freeze(expectedProperties)
});

// src/platform/computer-use/windows-cua-url.ts
function validatedBrowserUrl(value) {
  if (typeof value !== "string" || !value || value.length > 8192 || /[\s\x00-\x1f\x7f]/.test(value)) {
    throw new InvalidComputerUseInputError("open_url requires one HTTP/HTTPS URL without whitespace or control characters");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidComputerUseInputError("open_url requires a valid URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new InvalidComputerUseInputError("open_url allows only HTTP/HTTPS without embedded credentials");
  }
  return url.href;
}
function validateNativeBrowserLaunch(input) {
  if (Object.keys(input).length !== 1 || !Array.isArray(input.urls) || input.urls.length !== 1) {
    throw new InvalidComputerUseInputError("launch_app permits only one browser URL");
  }
  return { urls: [validatedBrowserUrl(input.urls[0])] };
}

// src/platform/computer-use/windows-cua-observation.ts
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function address(value) {
  const read = (field) => {
    const v = value[field];
    const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) throw new InvalidComputerUseInputError(`${field} must be a positive safe integer`);
    return n;
  };
  return { pid: read("pid"), window_id: read("window_id") };
}
function error(code) {
  return Object.assign(new Error(code), { code });
}
function foregroundKey(operation, input) {
  const a = address(input);
  const button = operation === "click" ? `:${input.button ?? "left"}:${input.count ?? 1}` : "";
  return `${a.pid}:${a.window_id}:${operation}${button}`;
}
var WindowsCuaObservationStore = class {
  nonce = randomBytes(16).toString("hex");
  foregroundGrants = /* @__PURE__ */ new Set();
  observations = /* @__PURE__ */ new Map();
  reset() {
    this.nonce = randomBytes(16).toString("hex");
    this.observations.clear();
    this.foregroundGrants.clear();
  }
  recordOutcome(operation, input, result) {
    const key = foregroundKey(operation, input);
    this.foregroundGrants.delete(key);
    const structured = object(result.structuredContent);
    const escalation = object(structured?.escalation);
    if (input.delivery_mode === "background" && result.isError && ["background_unavailable", "background_occluded"].includes(String(structured?.code)) && escalation?.recommended === "foreground") {
      if (this.foregroundGrants.size >= 16) this.foregroundGrants.delete(this.foregroundGrants.values().next().value);
      this.foregroundGrants.add(key);
    }
  }
  identity(input) {
    const a = address(input);
    return this.observations.get(`${a.pid}:${a.window_id}`);
  }
  backgroundDragRequiresMouse(input) {
    if (input.delivery_mode !== "background") return false;
    const a = address(input);
    const observation2 = this.observations.get(`${a.pid}:${a.window_id}`);
    const x = input.from_x;
    const y = input.from_y;
    return typeof x === "number" && typeof y === "number" && Boolean(observation2?.edits.some(
      (rect) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
    ));
  }
  backgroundGestureRequiresMouse(operation, input) {
    if (input.delivery_mode !== "background") return false;
    const complex = ["double_click", "right_click"].includes(operation) || operation === "click" && (input.button === "right" || Number(input.count ?? 1) > 1);
    if (!complex) return false;
    const a = address(input);
    const observation2 = this.observations.get(`${a.pid}:${a.window_id}`);
    if (typeof input.element_token === "string") return !observation2?.webTokens.has(input.element_token);
    const x = input.x;
    const y = input.y;
    return !(typeof x === "number" && typeof y === "number" && observation2?.webRegions.some(
      (rect) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
    ));
  }
  consume(input) {
    const a = address(input);
    this.observations.delete(`${a.pid}:${a.window_id}`);
  }
  record(input, result) {
    const a = address(input);
    const key = `${a.pid}:${a.window_id}`;
    this.observations.delete(key);
    const raw = object(result.structuredContent);
    if (!raw || raw.pid !== a.pid || raw.window_id !== a.window_id) throw error("COMPUTER_USE_OBSERVATION_TARGET_MISMATCH");
    if (result.isError || typeof raw.snapshot_id !== "string" || !/^s[0-9a-f]{8}$/.test(raw.snapshot_id) || typeof raw.capture_id !== "string" || !/^capture_[0-9a-f]{32}_[0-9a-f]{16}$/.test(raw.capture_id) || !Array.isArray(raw.elements) || result.images.length !== 1 || result.images[0].mimeType !== "image/png" || !result.images[0].data || result.images[0].filePath) throw error("COMPUTER_USE_OBSERVATION_INVALID");
    const png = validateComputerUsePng(result.images[0].data);
    if (png.width !== raw.screenshot_width || png.height !== raw.screenshot_height) throw error("COMPUTER_USE_OBSERVATION_INVALID");
    const snapshot = `w${this.nonce}:${raw.snapshot_id}`;
    const capture = `w${this.nonce}:${raw.capture_id}`;
    const indices = /* @__PURE__ */ new Map();
    const tokens = /* @__PURE__ */ new Map();
    const edits = [];
    const webTokens = /* @__PURE__ */ new Set();
    const webRegions = [];
    const elements = raw.elements.map((value) => {
      const element = object(value);
      const index = element?.element_index;
      const token = element?.element_token;
      if (!element || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || indices.has(index) || token !== `${raw.snapshot_id}:${index}`) throw error("COMPUTER_USE_OBSERVATION_INVALID");
      const publicToken = `w${this.nonce}:${token}`;
      indices.set(index, token);
      tokens.set(publicToken, token);
      if (element.in_web_content === true) webTokens.add(token);
      const frame = object(element.screenshot_frame);
      if (frame && ["x", "y", "w", "h"].every((k) => typeof frame[k] === "number" && Number.isFinite(frame[k])) && frame.w > 0 && frame.h > 0) {
        const rect = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
        if (element.role === "Edit") edits.push(rect);
        if (element.in_web_content === true) webRegions.push(rect);
      }
      return { ...element, element_token: publicToken };
    });
    if (this.observations.size >= 16) this.observations.delete(this.observations.keys().next().value);
    this.observations.set(key, { snapshot, capture, width: png.width, height: png.height, indices, tokens, edits, webTokens, webRegions });
    return { ...result, structuredContent: { ...raw, snapshot_id: snapshot, capture_id: capture, elements } };
  }
  prepare(action, input) {
    if (action === "open_url") {
      if (Object.keys(input).some((field) => field !== "url")) throw new InvalidComputerUseInputError("open_url accepts only url");
      return { urls: [validatedBrowserUrl(input.url)] };
    }
    if (["capture", "screenshot", "list_apps", "list_windows"].includes(action)) return { ...input };
    const a = address(input);
    const observation2 = this.observations.get(`${a.pid}:${a.window_id}`);
    if (!observation2) throw error("COMPUTER_USE_REOBSERVE_REQUIRED");
    const mode = input.delivery_mode ?? "background";
    if (mode !== "background" && mode !== "foreground") throw new InvalidComputerUseInputError("invalid delivery_mode");
    const contract2 = WINDOWS_CUA_ABI_PROFILE.contracts.find((contract3) => contract3.action === action);
    const grant = foregroundKey(contract2?.backendOperation, { ...input, ...contract2?.forced });
    if (mode === "foreground" && !this.foregroundGrants.has(grant)) throw new InvalidComputerUseInputError("foreground requires a background_unavailable response for this target and operation");
    const output = { ...input, ...a, delivery_mode: mode };
    if ((input.element_index !== void 0 || input.element_token !== void 0) && ["x", "y", "to_x", "to_y"].some((field) => input[field] !== void 0)) {
      throw new InvalidComputerUseInputError("Use either element or pixel targeting for one action");
    }
    if (input.element_index !== void 0 && input.element_token !== void 0) {
      throw new InvalidComputerUseInputError("Use either element_index or element_token for one action");
    }
    if (input.element_index !== void 0) {
      const index = typeof input.element_index === "string" && /^\d+$/.test(input.element_index) ? Number(input.element_index) : input.element_index;
      const token = typeof index === "number" ? observation2.indices.get(index) : void 0;
      if (!token || input.snapshot_id !== observation2.snapshot) throw error("COMPUTER_USE_REOBSERVE_REQUIRED");
      output.element_token = token;
    } else if (input.element_token !== void 0) {
      const token = typeof input.element_token === "string" ? observation2.tokens.get(input.element_token) : void 0;
      if (!token) throw error("COMPUTER_USE_REOBSERVE_REQUIRED");
      output.element_token = token;
    }
    if (input.capture_id !== void 0 && input.capture_id !== observation2.capture) throw error("COMPUTER_USE_REOBSERVE_REQUIRED");
    for (const [field, limit] of [["x", observation2.width], ["y", observation2.height], ["to_x", observation2.width], ["to_y", observation2.height]]) {
      const coordinate = input[field];
      if (coordinate !== void 0 && (typeof coordinate !== "number" || !Number.isFinite(coordinate) || coordinate < 0 || coordinate >= limit)) throw new InvalidComputerUseInputError(`${field} is outside the observed image`);
    }
    if ((action === "click" || action === "middle_click") && !output.element_token && input.x !== void 0 && input.y !== void 0) {
      output.capture_id = observation2.capture.slice(34);
    } else {
      delete output.capture_id;
    }
    if (mode === "foreground") this.foregroundGrants.delete(grant);
    delete output.element_index;
    delete output.snapshot_id;
    return output;
  }
};

// src/platform/computer-use/windows-cua-backend.ts
function isWindowsCuaReplaySafeCall(operation, input) {
  if (!["list_apps", "list_windows", "get_window_state"].includes(operation)) return false;
  const contract2 = WINDOWS_CUA_ABI_PROFILE.contracts.find((c) => c.backendOperation === operation);
  return Boolean(contract2 && Object.keys(input).every((field) => contract2.translatorAllowed.includes(field)));
}
function createWindowsCuaBackend(manager, options = {}) {
  const store = new WindowsCuaObservationStore();
  let generation = manager.generation;
  const synchronize = () => {
    if (generation !== manager.generation) {
      store.reset();
      generation = manager.generation;
    }
  };
  const reobserve = () => Object.assign(new Error("COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED"), { code: "COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED" });
  const queues = /* @__PURE__ */ new Map();
  let launchBarrier = Promise.resolve();
  const enqueue = async (name, input, callOptions, expected) => {
    const key = input.pid && input.window_id ? `${input.pid}:${input.window_id}` : "<catalog>";
    const previous = queues.get(key) ?? Promise.resolve();
    const predecessors = name === "launch_app" ? [...queues.values(), launchBarrier] : [previous, launchBarrier];
    const next = Promise.allSettled(predecessors).then(async () => {
      callOptions?.signal?.throwIfAborted();
      synchronize();
      if (!["get_window_state", "list_apps", "list_windows", "launch_app"].includes(name) && (!expected || store.identity(input) !== expected)) {
        throw Object.assign(new Error("COMPUTER_USE_REOBSERVE_REQUIRED"), { code: "COMPUTER_USE_REOBSERVE_REQUIRED" });
      }
      return perform(name, input, callOptions);
    });
    queues.set(key, next);
    if (name === "launch_app") launchBarrier = next;
    try {
      return await next;
    } finally {
      if (queues.get(key) === next) queues.delete(key);
    }
  };
  const perform = async (name, input, callOptions) => {
    synchronize();
    const current = manager.generation;
    const observation2 = ["get_window_state", "list_apps", "list_windows"].includes(name);
    if (name === "launch_app") {
      const launchInput = validateNativeBrowserLaunch(input);
      store.reset();
      try {
        const result = await manager.callToolResult(name, launchInput, callOptions);
        callOptions?.signal?.throwIfAborted();
        if (current !== manager.generation) {
          synchronize();
          throw reobserve();
        }
        return result;
      } finally {
        store.reset();
      }
    }
    try {
      const middle = name === "click" && input.button === "middle" && input.delivery_mode === "background";
      const textDrag = name === "drag" && store.backgroundDragRequiresMouse(input);
      const nonWebGesture = store.backgroundGestureRequiresMouse(name, input);
      const text = middle ? "Background middle click may invoke the primary action instead of the middle mouse button. No input was sent; capture again before explicitly choosing foreground middle click." : nonWebGesture ? "Background pen injection cannot reliably deliver this mouse gesture to a target without observed web content. No input was sent; capture again before explicitly choosing foreground mouse input." : "Background pen drag cannot reliably select text in this observed Edit. No input was sent; capture again before explicitly choosing foreground mouse drag.";
      const result = middle || textDrag || nonWebGesture ? { isError: true, text, summary: text, images: [], structuredContent: {
        code: "background_unavailable",
        source: "xiaok_host",
        inputSent: false,
        reason: middle ? "middle_click_requires_mouse_input" : nonWebGesture ? "non_web_gesture_requires_mouse_input" : "text_selection_requires_mouse_input",
        escalation: { recommended: "foreground" }
      } } : await manager.callToolResult(name, input, callOptions);
      callOptions?.signal?.throwIfAborted();
      if (current !== manager.generation) {
        synchronize();
        throw reobserve();
      }
      if (name === "get_window_state" && !result.isError) {
        const projected = store.record(input, result);
        options.onObserved?.();
        return projected;
      }
      if (!observation2) store.recordOutcome(name, input, result);
      if (!observation2 || name === "get_window_state" && result.isError) store.consume(input);
      return result;
    } catch (error2) {
      if (!observation2 || name === "get_window_state") {
        try {
          store.consume(input);
        } catch {
        }
      }
      throw error2;
    }
  };
  const backend = {
    abiProfile: WINDOWS_CUA_ABI_PROFILE,
    requiresImageInput: true,
    prepareActionInput: (action, input) => {
      synchronize();
      return store.prepare(action, input);
    },
    callToolResult: (name, input, options2) => enqueue(name, input, options2),
    acquireInvocation: () => {
      synchronize();
      const current = manager.generation;
      let expected;
      const invocation = {
        ...backend,
        prepareActionInput(action, input) {
          synchronize();
          const result = store.prepare(action, input);
          if (!["capture", "screenshot", "list_apps", "list_windows", "open_url"].includes(action)) expected = store.identity(input);
          return result;
        },
        callToolResult: (name, input, options2) => enqueue(name, input, options2, expected)
      };
      return { generation: current, backend: invocation, isCurrent: () => current === manager.generation };
    }
  };
  return backend;
}

// desktop/electron/windows-cua-runtime.ts
async function verifyWindowsCuaReadiness(input) {
  if (input.identity?.name !== "cua-driver" || input.identity.version !== WINDOWS_CUA_RELEASE.version) throw new Error("COMPUTER_USE_WINDOWS_IDENTITY_MISMATCH");
  const operations = input.schemas.map((schema) => {
    const required = schema.inputSchema.required ?? [];
    const properties = schema.inputSchema.properties;
    if (!Array.isArray(required) || !required.every((field) => typeof field === "string") || !properties || typeof properties !== "object" || Array.isArray(properties) || !Object.values(properties).every((value) => value && typeof value === "object" && !Array.isArray(value))) throw new Error("COMPUTER_USE_WINDOWS_ABI_MISMATCH");
    return { name: schema.name, required, properties };
  });
  if (!verifyBackendAbi(operations, WINDOWS_CUA_ABI_PROFILE).ok) throw new Error("COMPUTER_USE_WINDOWS_ABI_MISMATCH");
  const windows = await input.callToolResult("list_windows", { on_screen_only: true });
  const structured = windows.structuredContent;
  if (windows.isError || !Array.isArray(structured?.windows)) throw new Error("COMPUTER_USE_WINDOWS_OBSERVATION_INVALID");
  const target = input.target;
  if (!target || !structured.windows.some((value) => value && typeof value === "object" && value.pid === target.pid && value.window_id === target.window_id)) return { observed: false };
  const args = { ...target, include_screenshot: true };
  const capture = await input.callToolResult("get_window_state", args);
  new WindowsCuaObservationStore().record(args, capture);
  return { observed: true };
}
export {
  CuaConnectionManager,
  InvocationToolImages,
  WINDOWS_CUA_ABI_PROFILE,
  WINDOWS_CUA_RELEASE,
  createComputerUseTool,
  createWindowsCuaBackend,
  detectNativeWindowsArchitecture,
  detectWindowsInteractiveDesktop,
  installPrivateCuaRelease,
  isWindowsCuaReplaySafeCall,
  normalizeMcpRuntimeToolResult,
  resolveActivePrivateCuaRelease,
  runDependencyProcess,
  verifyBackendAbi,
  verifyWindowsCuaReadiness
};
