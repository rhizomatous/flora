package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

// Release builds embed the registry digest returned after publishing the image.
// Development builds leave the runtime opt-in through -agent-image.
var releaseVersion = "development"
var releaseCommit = "unknown"
var releaseImage = ""

func init() {
	flag.BoolFunc("version", "print embedded release identity and exit", func(string) error {
		b, err := json.Marshal(struct {
			Version string `json:"version"`
			Commit  string `json:"commit"`
			Image   string `json:"agent_image"`
			Harness string `json:"harness_version"`
		}{releaseVersion, releaseCommit, releaseImage, "1.2.27"})
		if err != nil {
			return err
		}
		fmt.Println(string(b))
		os.Exit(0)
		return nil
	})
}
