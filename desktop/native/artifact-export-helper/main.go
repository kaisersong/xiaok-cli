// This unprivileged helper copies an explicitly selected user's artifact. It
// issues no grant, makes no proof, and is not the scoped P2 filesystem adapter.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

type fileIdentity struct {
	Device string `json:"device"`
	Inode  string `json:"inode"`
}
type receipt struct {
	Stage     string        `json:"stage"`
	OK        bool          `json:"ok"`
	Committed bool          `json:"committed"`
	Cleanup   string        `json:"cleanup,omitempty"`
	Identity  *fileIdentity `json:"identity,omitempty"`
	SHA256    string        `json:"sha256,omitempty"`
	Size      int64         `json:"size,omitempty"`
	Error     string        `json:"error,omitempty"`
}

func basename(name string) bool {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\x00") {
		return false
	}
	if runtime.GOOS != "windows" {
		return true
	}
	if strings.ContainsAny(name, "\\:<>\"|?*") || strings.HasSuffix(name, ".") || strings.HasSuffix(name, " ") {
		return false
	}
	for _, c := range name {
		if c < 32 {
			return false
		}
	}
	// Use Go's Windows reserved-device parser, including console handles and
	// superscript COM/LPT digits. Strip the extension and ignored stem spaces
	// first so the same conservative rule applies across Windows versions.
	stem := strings.TrimRight(strings.Split(name, ".")[0], " ")
	if stem != "" && !filepath.IsLocal(stem) {
		return false
	}
	return true
}

func plainAncestors(path string) bool {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return false
	}
	for {
		info, err := os.Lstat(path)
		if err != nil || !plainDirectory(path, info) {
			return false
		}
		parent := filepath.Dir(path)
		if parent == path {
			return true
		}
		path = parent
	}
}

func command(input io.Reader, expected byte) bool {
	var value [1]byte
	_, err := io.ReadFull(input, value[:])
	return err == nil && value[0] == expected
}

func ownershipTrailer(token string) []byte { return []byte("xiaok-export-owner-v1:" + token + "\n") }
func validToken(token string) bool {
	decoded, err := hex.DecodeString(token)
	return err == nil && len(decoded) == 32 && token == strings.ToLower(token)
}
func tokenMatches(file *os.File, size int64, token string) bool {
	expected := ownershipTrailer(token)
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != size+int64(len(expected)) {
		return false
	}
	actual := make([]byte, len(expected))
	n, err := file.ReadAt(actual, size)
	return err == nil && n == len(actual) && bytes.Equal(actual, expected)
}
func fileHash(file *os.File, size int64, token string) (string, error) {
	before, err := file.Stat()
	if err != nil || !before.Mode().IsRegular() || !tokenMatches(file, size, token) {
		return "", errors.New("file_changed")
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	h := sha256.New()
	n, err := io.CopyN(h, file, size)
	after, statErr := file.Stat()
	if err != nil || statErr != nil || n != size || after.Size() != before.Size() || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) || !tokenMatches(file, size, token) {
		return "", errors.New("file_changed")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func sameEntry(root *os.Root, name string, file *os.File) bool {
	held, err := file.Stat()
	if err != nil || !held.Mode().IsRegular() {
		return false
	}
	entry, err := root.Lstat(name)
	return err == nil && entry.Mode().IsRegular() && !reparse(entry) && os.SameFile(held, entry)
}

// These are checked basename operations within the held directory. They are
// deliberately not advertised as an atomic compare-by-file-ID sandbox against
// a malicious process which can edit the user's own files in between syscalls.
func run(ctx context.Context, args []string, input io.Reader, output io.Writer) (result error) {
	encoder := json.NewEncoder(output)
	var root *os.Root
	var directory, temporary *os.File
	var temporaryName string
	committed := false
	defer func() {
		cleanup := "none"
		if temporary != nil {
			cleanup = "unknown"
			if sameEntry(root, temporaryName, temporary) && root.Remove(temporaryName) == nil {
				cleanup = "removed"
				if syncDirectory(directory) != nil {
					cleanup = "unknown"
				}
			}
			if temporary.Close() != nil {
				cleanup = "unknown"
			}
		}
		if directory != nil {
			_ = directory.Close()
		}
		if root != nil {
			_ = root.Close()
		}
		code := ""
		if result != nil {
			code = result.Error()
		}
		if cleanup == "unknown" && result == nil {
			result = errors.New("cleanup_unknown")
			code = result.Error()
		}
		_ = encoder.Encode(receipt{Stage: "finished", OK: result == nil, Committed: committed, Cleanup: cleanup, Error: code})
	}()
	if len(args) != 8 {
		return errors.New("arguments")
	}
	parent, temporaryName, target := args[0], args[1], args[2]
	if !plainAncestors(parent) || !basename(temporaryName) || !strings.HasPrefix(temporaryName, ".xiaok-export-") || !basename(target) || target == temporaryName {
		return errors.New("path")
	}
	size, err := strconv.ParseInt(args[3], 10, 64)
	if err != nil || size < 0 || size > 16*1024*1024 {
		return errors.New("size")
	}
	expectedHash := args[4]
	decoded, err := hex.DecodeString(expectedHash)
	if err != nil || len(decoded) != 32 || expectedHash != strings.ToLower(expectedHash) {
		return errors.New("hash")
	}
	token := args[7]
	if !validToken(token) {
		return errors.New("token")
	}
	expected := fileIdentity{args[5], args[6]}
	root, err = os.OpenRoot(parent)
	if err != nil {
		return errors.New("directory_open")
	}
	directory, err = root.Open(".")
	if err != nil {
		return errors.New("directory_open")
	}
	actual, err := identity(directory)
	if err != nil || actual != expected || !plainAncestors(parent) {
		return errors.New("directory_identity")
	}
	if err = encoder.Encode(receipt{Stage: "ready", OK: true, Identity: &actual}); err != nil {
		return errors.New("reply")
	}
	if !command(input, 'C') || ctx.Err() != nil {
		return errors.New("create_not_requested")
	}
	temporary, err = root.OpenFile(temporaryName, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("create_failed")
	}
	if lockFile(temporary) != nil {
		return errors.New("file_lock")
	}
	if count, err := linkCount(temporary); err != nil || count != 1 {
		return errors.New("file_token")
	}
	trailer := ownershipTrailer(token)
	if n, err := temporary.WriteAt(trailer, size); err != nil || n != len(trailer) {
		return errors.New("file_token")
	}
	if temporary.Sync() != nil {
		return errors.New("file_token")
	}
	created, err := identity(temporary)
	if err != nil {
		return errors.New("file_identity")
	}
	if err = encoder.Encode(receipt{Stage: "created", OK: true, Identity: &created}); err != nil {
		return errors.New("reply")
	}
	if !command(input, 'W') || ctx.Err() != nil {
		return errors.New("write_not_requested")
	}
	if count, err := linkCount(temporary); err != nil || count != 1 {
		return errors.New("write_failed")
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		return errors.New("write_failed")
	}
	if n, err := io.CopyN(temporary, input, size); err != nil || n != size {
		return errors.New("write_failed")
	}
	if temporary.Sync() != nil {
		return errors.New("sync_failed")
	}
	writtenHash, err := fileHash(temporary, size, token)
	if err != nil || writtenHash != expectedHash || !sameEntry(root, temporaryName, temporary) {
		return errors.New("content_changed")
	}
	if err = encoder.Encode(receipt{Stage: "staged", OK: true, Identity: &created, SHA256: writtenHash, Size: size}); err != nil {
		return errors.New("reply")
	}
	if !command(input, 'K') || ctx.Err() != nil {
		return errors.New("commit_not_requested")
	}
	// Main sends its unique commit via stdin.end("K"). Additional commands are
	// rejected before the filesystem publication, rather than silently ignored.
	var extra [1]byte
	if n, err := input.Read(extra[:]); n != 0 || err != io.EOF {
		return errors.New("extra_command")
	}
	finalHash, err := fileHash(temporary, size, token)
	if err != nil || finalHash != expectedHash || !sameEntry(root, temporaryName, temporary) {
		return errors.New("content_changed")
	}
	if ctx.Err() != nil {
		return errors.New("cancelled")
	}
	if count, err := linkCount(temporary); err != nil || count != 1 {
		return errors.New("content_changed")
	}
	// Only the exact original payload may become visible at the destination.
	// A crash after stripping the token leaves conservative unknown recovery.
	if temporary.Truncate(size) != nil || temporary.Sync() != nil {
		return errors.New("commit_prepare_failed")
	}
	if root.Link(temporaryName, target) != nil {
		return errors.New("link_failed")
	}
	committed = true
	if !sameEntry(root, target, temporary) {
		return errors.New("target_changed")
	}
	if syncDirectory(directory) != nil {
		return errors.New("directory_sync_failed")
	}
	return nil
}

type recoveryReceipt struct {
	Stage    string        `json:"stage"`
	OK       bool          `json:"ok"`
	Cleanup  string        `json:"cleanup"`
	Identity *fileIdentity `json:"identity,omitempty"`
	Token    string        `json:"token,omitempty"`
	Error    string        `json:"error,omitempty"`
}

// Recovery never creates or publishes a file, and never examines a final target.
// The token rules out accidental inode reuse, not a malicious same-UID forger.
func recoverExport(ctx context.Context, args []string, output io.Writer) (result error) {
	var root *os.Root
	var directory, temporary *os.File
	var actual fileIdentity
	var token string
	defer func() {
		for _, file := range []*os.File{temporary, directory} {
			if file != nil {
				if err := file.Close(); err != nil && result == nil {
					result = errors.New("close_failed")
				}
			}
		}
		if root != nil {
			if err := root.Close(); err != nil && result == nil {
				result = errors.New("close_failed")
			}
		}
		if ctx.Err() != nil && result == nil {
			result = errors.New("cancelled")
		}
		r := recoveryReceipt{Stage: "recovered", OK: result == nil, Cleanup: "unknown"}
		if result == nil {
			r.Cleanup = "removed"
			r.Identity = &actual
			r.Token = token
		} else {
			r.Error = result.Error()
		}
		if err := json.NewEncoder(output).Encode(r); err != nil && result == nil {
			result = errors.New("reply")
		}
	}()
	if len(args) != 10 {
		return errors.New("arguments")
	}
	parent, name, expectedHash, phase := args[0], args[1], args[3], args[9]
	token = args[8]
	if !plainAncestors(parent) || !basename(name) || !strings.HasPrefix(name, ".xiaok-export-") {
		return errors.New("path")
	}
	size, err := strconv.ParseInt(args[2], 10, 64)
	if err != nil || size < 0 || size > 16*1024*1024 {
		return errors.New("size")
	}
	if !validToken(token) || !validToken(expectedHash) {
		return errors.New("token")
	}
	if phase != "created" && phase != "staged" && phase != "committing" {
		return errors.New("phase")
	}
	expectedParent, expectedFile := fileIdentity{args[4], args[5]}, fileIdentity{args[6], args[7]}
	if ctx.Err() != nil {
		return errors.New("cancelled")
	}
	root, err = os.OpenRoot(parent)
	if err != nil {
		return errors.New("directory_open")
	}
	directory, err = root.Open(".")
	if err != nil {
		return errors.New("directory_open")
	}
	parentID, err := identity(directory)
	if err != nil || parentID != expectedParent || !plainAncestors(parent) {
		return errors.New("directory_identity")
	}
	entry, err := root.Lstat(name)
	if err != nil || !entry.Mode().IsRegular() || reparse(entry) {
		return errors.New("file_open")
	}
	temporary, err = root.OpenFile(name, os.O_RDONLY, 0)
	if err != nil {
		return errors.New("file_open")
	}
	actual, err = identity(temporary)
	if err != nil || actual != expectedFile || !sameEntry(root, name, temporary) {
		return errors.New("file_identity")
	}
	if lockFile(temporary) != nil {
		return errors.New("file_lock")
	}
	if !tokenMatches(temporary, size, token) {
		return errors.New("file_token")
	}
	if phase != "created" {
		hash, err := fileHash(temporary, size, token)
		if err != nil || hash != expectedHash {
			return errors.New("content_changed")
		}
	}
	if ctx.Err() != nil {
		return errors.New("cancelled")
	}
	if !sameEntry(root, name, temporary) || !tokenMatches(temporary, size, token) {
		return errors.New("file_identity")
	}
	if root.Remove(name) != nil {
		return errors.New("remove_failed")
	}
	if syncDirectory(directory) != nil {
		return errors.New("directory_sync_failed")
	}
	return nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// A reader created from an inherited blocking stdin descriptor need not be
	// pollable. Closing stdin itself may therefore leave its read blocked. This
	// owned pipe is pollable; closing its writer wakes run and drains filesystem
	// cleanup. The copy goroutine performs no filesystem mutation and dies with
	// this one-shot process if its original stdin remains blocked.
	reader, writer, err := os.Pipe()
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "artifact_export_pipe_failed")
		os.Exit(1)
	}
	go func() { _, _ = io.Copy(writer, os.Stdin); _ = writer.Close() }()
	go func() { <-ctx.Done(); _ = writer.Close() }()
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "--recover" {
		err = recoverExport(ctx, args[1:], os.Stdout)
	} else {
		err = run(ctx, args, reader, os.Stdout)
	}
	_ = reader.Close()
	_ = writer.Close()
	stop()
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "artifact_export_failed")
		os.Exit(1)
	}
}
