// Package webassets contains the compiled React application.
// Run `make web` from the repository root before compiling Go.
package webassets

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var assets embed.FS

func FS() fs.FS {
	files, err := fs.Sub(assets, "dist")
	if err != nil {
		panic(err)
	}
	return files
}
