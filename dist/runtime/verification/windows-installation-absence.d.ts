type WindowsInstallationObservation = 'ordinary' | 'installed' | 'unavailable';
/** Fixed client-bundled read-only helper. This is not a protected Windows
 * controller or a qualification receipt. Missing build artifacts deny fallback. */
export declare function readWindowsInstallationAbsence(): WindowsInstallationObservation;
export {};
