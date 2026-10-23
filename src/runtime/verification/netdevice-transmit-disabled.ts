/** Fixed Linux-worker evidence for netdevice-mediated IPv4/IPv6/L2 only.
 * This does not qualify VSOCK, Unix sockets, shared memory or parent host IPC.
 * The functions are shared with ordinary controls; no caller-selected paths,
 * command callbacks, authority or qualification issuer are exposed. */
export const NETDEVICE_CHECK_FUNCTIONS=String.raw`
# Evidence scope: netdevice-mediated IPv4/IPv6/L2 transmit-disabled only.
# VSOCK, Unix sockets and other host IPC remain separate parent gates.
netdevice_fd_fact_valid() {
  [ "$#" = 6 ] || return 1
  printf '%s\n' "$1|$2|$3|$4|$5|$6" | awk -F '|' '
    function number(s,b, i,n,c,p) {
      if (s=="" || length(s)>12) return -1
      n=0
      for(i=1;i<=length(s);i++) { c=tolower(substr(s,i,1));p=index("0123456789abcdef",c)-1;if(p<0||p>=b)return -1;n=n*b+p;if(n>4294967295)return -1 }
      return n
    }
    { if(NF!=6)exit 1;mode=number($3,16);major=number($4,16);minor=number($5,16);flags=number($6,8)
      if(mode<0||major<0||minor<0||flags<0)exit 1
      kind=int(mode/4096)%16;access=flags%4
      if($1=="0") { if($2!="/dev/null"||kind!=2||major!=1||minor!=3||(access!=0&&access!=2))exit 1 }
      else if($1=="1"||$1=="2") { if($2!~/^pipe:\[[0-9]+\]$/||kind!=1||major!=0||minor!=0||access!=1)exit 1 }
      else exit 1
      seen++
    }
    END { if(seen!=1)exit 1 }'
}
netdevice_inherited_fds_valid() {
  # Observe the worker from a separate process: globbing its own fd directory
  # can enumerate the observer's temporary directory descriptor as a false extra.
  nd_subject_pid=$$
  (
    [ -d /proc/"$nd_subject_pid"/fd ] && [ -r /proc/"$nd_subject_pid"/fd ] && [ -x /proc/"$nd_subject_pid"/fd ] || return 1
    nd_count=0
    for nd_path in /proc/"$nd_subject_pid"/fd/*; do
      nd_fd=$(basename "$nd_path") || return 1
      case "$nd_fd" in 0|1|2) ;; *) return 1 ;; esac
      nd_target=$(readlink "$nd_path") || return 1
      nd_stat=$(stat -L -c '%f %t %T' "$nd_path") || return 1
      printf '%s\n' "$nd_stat" | grep -Eq '^[0-9a-f]+ [0-9a-f]+ [0-9a-f]+$' || return 1
      nd_flags=$(awk '$1=="flags:" {if(++n!=1||NF!=2)exit 1;f=$2} END {if(n!=1)exit 1;print f}' /proc/"$nd_subject_pid"/fdinfo/"$nd_fd") || return 1
      set -- $nd_stat
      netdevice_fd_fact_valid "$nd_fd" "$nd_target" "$1" "$2" "$3" "$nd_flags" || return 1
      nd_count=$((nd_count+1))
    done
    [ "$nd_count" = 3 ]
  )
  # A command after the subshell prevents a last-command no-fork optimization.
  return "$?"
}
netdevice_capabilities_valid() {
  awk '
    /^Cap(Eff|Prm|Inh|Amb|Bnd):/ {if(NF!=2||$2!="0000000000000000"||seen[$1]++)bad=1;caps++}
    /^NoNewPrivs:/ {if(NF!=2||$2!="1"||seen[$1]++)bad=1;nnp++}
    /^Seccomp:/ {if(NF!=2||$2!="2"||seen[$1]++)bad=1;seccomp++}
    END {if(bad||caps!=5||nnp!=1||seccomp!=1)exit 1}'
}
netdevice_path_readonly() {
  awk -v path="$1" '
    function covers(a,b) {return b=="/"||a==b||index(a,b"/")==1}
    {if(NF!=6){bad=1;next};ro=(","$4",")~ /,ro,/;rw=(","$4",")~ /,rw,/
     if(covers(path,$2)&&length($2)>best){best=length($2);safe=ro&&!rw}
     if(covers($2,path)&&(!ro||rw))bad=1}
    END {if(bad||!best||!safe)exit 1}'
}
netdevice_proc_names() {
  awk '
    NR==1 {if($0!~/^[[:space:]]*Inter-\|[[:space:]]*Receive[[:space:]]*\|[[:space:]]*Transmit[[:space:]]*$/)bad=1;next}
    NR==2 {header=$0;gsub(/[[:space:]]+/," ",header);gsub(/^ | $/,"",header);if(header!="face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed")bad=1;next}
    {n=split($0,p,":");name=p[1];gsub(/^[[:space:]]+|[[:space:]]+$/,"",name)
     if(n!=2||name!~/^[A-Za-z0-9_.-]+$/||length(name)>15||seen[name]++){bad=1;next}
     counters=p[2];gsub(/^[[:space:]]+|[[:space:]]+$/,"",counters);n=split(counters,a,/[[:space:]]+/)
     if(n!=16){bad=1;next};for(i=1;i<=n;i++)if(a[i]!~/^[0-9]+$/)bad=1
     names[++count]=name}
    END {if(bad||NR<3||count<1)exit 1;for(i=1;i<=count;i++)print names[i]}'
}
netdevice_rows_valid() {
  [ "$#" = 2 ] || return 1
  printf '%s\n--NETDEVICE-ROWS--\n%s\n' "$1" "$2" | awk '
    function hexadecimal(s, i,n,c,p) {
      if(s!~/^0x[0-9a-fA-F]+$/||length(s)>10)return -1;n=0
      for(i=3;i<=length(s);i++){c=tolower(substr(s,i,1));p=index("0123456789abcdef",c)-1;n=n*16+p}
      return n
    }
    $0=="--NETDEVICE-ROWS--" {if(section++)bad=1;next}
    !section {if(NF!=1||$1!~/^[A-Za-z0-9_.-]+$/||length($1)>15||proc[$1]++)bad=1;population++;next}
    {if($2!~/^[A-Za-z0-9_.-]+$/||seen[$2]++){bad=1;next}
     if($1=="C") {if(NF!=3||length($2)>255||$3!="regular"||($2 in proc))bad=1;next}
     if($1!="N"||NF!=5||length($2)>15||!($2 in proc)||$3!~/^[1-9][0-9]*$/||$3+0>2147483647||indexSeen[$3]++||$4!~/^[0-9]+$/||$4+0>65535){bad=1;next}
     flags=hexadecimal($5);if(flags<0){bad=1;next}
     loop=int(flags/8)%2
     if((loop==1)!=($4+0==772))bad=1
     if(loop)loops++;else if(flags%2)bad=1
     devices++;matched[$2]=1}
    END {if(bad||section!=1||population<1||devices!=population||loops!=1)exit 1;for(name in proc)if(!(name in matched))exit 1}'
}
netdevice_snapshot() {
  nd_namespace=$(readlink /proc/$$/ns/net) || return 1
  printf '%s\n' "$nd_namespace" | grep -Eq '^net:\[[0-9]+\]$' || return 1
  nd_proc=$(netdevice_proc_names < /proc/net/dev) || return 1
  nd_rows=$(
    for nd_entry in /sys/class/net/*; do
      nd_name=$(basename "$nd_entry") || exit 1
      if [ -L "$nd_entry" ] && [ -d "$nd_entry" ]; then
        nd_real=$(readlink -f "$nd_entry") || exit 1
        case "$nd_real" in /sys/devices/*) ;; *) exit 1 ;; esac
        netdevice_path_readonly "$nd_real" < /proc/mounts || exit 1
        [ -f "$nd_entry/ifindex" ] && [ -f "$nd_entry/type" ] && [ -f "$nd_entry/flags" ] || exit 1
        nd_index=$(cat "$nd_entry/ifindex") || exit 1
        nd_type=$(cat "$nd_entry/type") || exit 1
        nd_flags=$(cat "$nd_entry/flags") || exit 1
        printf 'N %s %s %s %s\n' "$nd_name" "$nd_index" "$nd_type" "$nd_flags" || exit 1
      elif [ -f "$nd_entry" ] && [ ! -L "$nd_entry" ] && [ ! -e "$nd_entry/ifindex" ]; then
        # A regular sysfs control file is not a netdevice. Population parity below
        # prevents a missing proc device from being disguised as such a file.
        printf 'C %s regular\n' "$nd_name" || exit 1
      else
        exit 1
      fi
    done
  ) || return 1
  netdevice_rows_valid "$nd_proc" "$nd_rows" || return 1
  nd_mounts=$(cat /proc/mounts) || return 1
  printf '%s\n--PROC--\n%s\n--SYSFS--\n%s\n--MOUNTS--\n%s\n' "$nd_namespace" "$nd_proc" "$nd_rows" "$nd_mounts"
}
netdevice_snapshots_equal() {
  [ "$#" = 2 ] && [ -n "$1" ] && [ "$1" = "$2" ]
}
netdevice_transmit_disabled() {
  # Complete inherited-FD admission: data sockets, namespace/VSOCK/tun/tap,
  # anon_inode, regular files and unknown/bidirectional endpoints all reject.
  netdevice_inherited_fds_valid || return 1
  netdevice_capabilities_valid < /proc/$$/status || return 1
  [ ! -e /dev/net/tun ] || return 1
  netdevice_path_readonly /sys/class/net < /proc/mounts || return 1
  netdevice_path_readonly /proc/sys/net < /proc/mounts || return 1
  nd_before=$(netdevice_snapshot) || return 1
  nd_after=$(netdevice_snapshot) || return 1
  netdevice_snapshots_equal "$nd_before" "$nd_after" || return 1
  netdevice_path_readonly /sys/class/net < /proc/mounts || return 1
  netdevice_path_readonly /proc/sys/net < /proc/mounts || return 1
  [ ! -e /dev/net/tun ] || return 1
  netdevice_capabilities_valid < /proc/$$/status || return 1
  netdevice_inherited_fds_valid || return 1
}
`;

export function buildNetdeviceTransmitDisabledCheck():string {
 return NETDEVICE_CHECK_FUNCTIONS+String.raw`
if netdevice_transmit_disabled; then
  :
else
  printf 'qualification_probe stage=netdevice_transmit_disabled\n' >&2
  exit 1
fi
`;
}

function fields(value:unknown,required:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==required.length)throw Error('qualification_network_attachment');
 const result:Record<string,unknown>={};
 for(const key of required){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value' in descriptor))throw Error('qualification_network_attachment');result[key]=descriptor.value;}
 return result;
}
/** Exact terminal daemon attachment evidence, additional to every original
 * HostConfig check. Not a cleanup identity check or a pre-kill eligibility gate;
 * NetworkMode=none alone is not a transmit-disabled proof. */
export function assertDockerNoneNetworkAttachment(value:unknown):void{
 const settings=fields(value,['SandboxID','SandboxKey','Ports','Networks']);
 if(settings.SandboxID!==''||settings.SandboxKey!=='')throw Error('qualification_network_attachment');
 fields(settings.Ports,[]);
 const networks=fields(settings.Networks,['none']);
 const none=fields(networks.none,['IPAMConfig','Links','Aliases','DriverOpts','GwPriority','NetworkID','EndpointID','Gateway','IPAddress','MacAddress','IPPrefixLen','IPv6Gateway','GlobalIPv6Address','GlobalIPv6PrefixLen','DNSNames']);
 for(const key of ['IPAMConfig','Links','Aliases','DriverOpts','DNSNames'])if(none[key]!==null)throw Error('qualification_network_attachment');
 for(const key of ['EndpointID','Gateway','IPAddress','MacAddress','IPv6Gateway','GlobalIPv6Address'])if(none[key]!=='')throw Error('qualification_network_attachment');
 for(const key of ['GwPriority','IPPrefixLen','GlobalIPv6PrefixLen'])if(none[key]!==0)throw Error('qualification_network_attachment');
 if(typeof none.NetworkID!=='string'||!/^[a-f0-9]{64}$/.test(none.NetworkID))throw Error('qualification_network_attachment');
}
