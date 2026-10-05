//go:build darwin || linux

package main

import (
	"os"
	"strconv"
	"syscall"
)

func identity(file *os.File) (fileIdentity, error) {
	info, err := file.Stat()
	if err != nil {
		return fileIdentity{}, err
	}
	stat := info.Sys().(*syscall.Stat_t)
	return fileIdentity{strconv.FormatUint(uint64(stat.Dev), 10), strconv.FormatUint(uint64(stat.Ino), 10)}, nil
}
func reparse(info os.FileInfo) bool { return false }
func plainDirectory(path string, info os.FileInfo) bool {
	return info.IsDir() && info.Mode()&os.ModeSymlink == 0
}
func syncDirectory(file *os.File) error { return file.Sync() }
func lockFile(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}
func linkCount(file *os.File) (uint64, error) {
	info, err := file.Stat()
	if err != nil {
		return 0, err
	}
	return uint64(info.Sys().(*syscall.Stat_t).Nlink), nil
}
