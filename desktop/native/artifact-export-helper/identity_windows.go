//go:build windows

package main

import (
	"encoding/binary"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

func identity(file *os.File) (fileIdentity, error) {
	var info syscall.ByHandleFileInformation
	err := syscall.GetFileInformationByHandle(syscall.Handle(file.Fd()), &info)
	if err != nil {
		return fileIdentity{}, err
	}
	return fileIdentity{strconv.FormatUint(uint64(info.VolumeSerialNumber), 10), strconv.FormatUint(uint64(info.FileIndexHigh)<<32|uint64(info.FileIndexLow), 10)}, nil
}
func reparse(info os.FileInfo) bool {
	data, ok := info.Sys().(*syscall.Win32FileAttributeData)
	return !ok || data.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0
}

// A mounted volume and a directory junction share the MOUNT_POINT tag. Permit
// only an actual volume GUID target confirmed by the mounted-folder API; never
// permit arbitrary junction targets or symbolic-link reparse tags.
func plainDirectory(path string, info os.FileInfo) bool {
	if !reparse(info) {
		return info.IsDir() && info.Mode()&os.ModeSymlink == 0
	}
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return false
	}
	handle, err := syscall.CreateFile(name, 0, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE, nil, syscall.OPEN_EXISTING, syscall.FILE_FLAG_OPEN_REPARSE_POINT|syscall.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(handle)
	var data [16384]byte
	var returned uint32
	if syscall.DeviceIoControl(handle, syscall.FSCTL_GET_REPARSE_POINT, nil, 0, &data[0], uint32(len(data)), &returned, nil) != nil || returned < 16 || returned > uint32(len(data)) {
		return false
	}
	if binary.LittleEndian.Uint32(data[:4]) != 0xA0000003 {
		return false
	}
	length := int(binary.LittleEndian.Uint16(data[4:6])) + 8
	start := int(binary.LittleEndian.Uint16(data[8:10])) + 16
	count := int(binary.LittleEndian.Uint16(data[10:12]))
	if length > int(returned) || start%2 != 0 || count%2 != 0 || start+count > length || count != 98 {
		return false
	}
	units := make([]uint16, count/2)
	for i := range units {
		units[i] = binary.LittleEndian.Uint16(data[start+2*i : start+2*i+2])
	}
	target := string(utf16.Decode(units))
	if !strings.HasPrefix(target, `\??\Volume{`) || !strings.HasSuffix(target, `}\`) {
		return false
	}
	guid := target[11:47]
	for i, c := range guid {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	mount, err := syscall.UTF16PtrFromString(strings.TrimRight(path, `\`) + `\`)
	if err != nil {
		return false
	}
	var volume [50]uint16
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetVolumeNameForVolumeMountPointW")
	if proc.Find() != nil {
		return false
	}
	ok, _, _ := proc.Call(uintptr(unsafe.Pointer(mount)), uintptr(unsafe.Pointer(&volume[0])), uintptr(len(volume)))
	return ok != 0 && strings.EqualFold(syscall.UTF16ToString(volume[:]), `\\?\`+target[4:])
}

// Windows flushes the written file before staging. Directory FlushFileBuffers
// is not a portable durability primitive; no power-loss guarantee is inferred.
func syncDirectory(file *os.File) error { return nil }

// The single coordination byte lies beyond the largest permitted payload.
// os.Root.OpenFile uses Openat with FILE_SHARE_DELETE in the pinned Go SDK.
// Keep this lock until the actual file handle closes, including during unlink.
func lockFile(file *os.File) error {
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("LockFileEx")
	if err := proc.Find(); err != nil {
		return err
	}
	overlapped := syscall.Overlapped{Offset: 16 * 1024 * 1024}
	ok, _, err := proc.Call(file.Fd(), 3, 0, 1, 0, uintptr(unsafe.Pointer(&overlapped)))
	runtime.KeepAlive(&overlapped)
	if ok == 0 {
		if err != syscall.Errno(0) {
			return err
		}
		return syscall.EINVAL
	}
	return nil
}
func linkCount(file *os.File) (uint64, error) {
	var info syscall.ByHandleFileInformation
	if err := syscall.GetFileInformationByHandle(syscall.Handle(file.Fd()), &info); err != nil {
		return 0, err
	}
	return uint64(info.NumberOfLinks), nil
}
