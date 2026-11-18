package workspace

import (
	"context"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"syscall"
	"time"
)

const SearchLimit = 100
const searchEntries = 20000

type SearchResults struct {
	Paths     []string `json:"paths"`
	Truncated bool     `json:"truncated"`
}

// Search walks names only and skips listed symlinks without reading file contents.
// os.Root confines replaced directory entries to the repository. Time, entry,
// and result limits bound a search of an agent-controlled checkout.
func Search(ctx context.Context, root *os.Root, query string) (SearchResults, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	result := SearchResults{Paths: []string{}}
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return result, nil
	}
	directories := []string{"."}
	visited := 0
	for len(directories) > 0 {
		if ctx.Err() != nil {
			result.Truncated = true
			break
		}
		name := directories[len(directories)-1]
		directories = directories[:len(directories)-1]
		f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
		if err != nil {
			if name == "." {
				return result, err
			}
			result.Truncated = true
			break
		}
		info, err := f.Stat()
		if err != nil || !info.IsDir() {
			f.Close()
			result.Truncated = true
			break
		}
		for {
			if ctx.Err() != nil || visited >= searchEntries {
				result.Truncated = true
				break
			}
			entries, readErr := f.ReadDir(DirectoryLimit)
			for _, entry := range entries {
				visited++
				candidate := path.Join(name, entry.Name())
				if !ValidPath(candidate) {
					continue
				}
				if entry.Type()&os.ModeSymlink != 0 {
					continue
				}
				if entry.IsDir() {
					directories = append(directories, candidate)
					continue
				}
				if entry.Type().IsRegular() && strings.Contains(strings.ToLower(candidate), query) {
					result.Paths = append(result.Paths, candidate)
					if len(result.Paths) >= SearchLimit {
						result.Truncated = true
						break
					}
				}
			}
			if result.Truncated || readErr != nil {
				if readErr != nil && readErr != io.EOF {
					result.Truncated = true
				}
				break
			}
		}
		f.Close()
		if result.Truncated {
			break
		}
	}
	sort.Strings(result.Paths)
	return result, nil
}
