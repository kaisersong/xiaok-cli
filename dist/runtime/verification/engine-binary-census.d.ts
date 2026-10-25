export declare function verifyEngineBinaryCensus(expected: readonly {
    name: string;
    sha256: string;
    size: number;
}[], raw: string): void;
export declare const ENGINE_BINARY_CENSUS_SCRIPT = "set -eu\nfor name in containerd containerd-shim-runc-v2 ctr docker docker-init docker-proxy dockerd runc; do\n path=/usr/local/lib/xiaok-engine/$name\n [ ! -L \"$path\" ] && [ -f \"$path\" ]\n printf '%s %s %s\\n' \"$name\" \"$(sha256sum \"$path\" | cut -d ' ' -f 1)\" \"$(stat -c '%u %g %a %h %s' \"$path\")\"\ndone\n";
