package storage

import "testing"

func TestRepositoryPaths(t *testing.T) {
	a := Repository{Name: "first/app", Role: "core"}
	b := Repository{Name: "second/app", Role: "core"}
	c := Configuration{Repositories: []Repository{a}}
	if RepositoryPath(c, a) != "/workspace" {
		t.Fatal("single core checkout moved")
	}
	c.Repositories = append(c.Repositories, b)
	if RepositoryPath(c, a) != "/workspace/repos/first/app" || RepositoryPath(c, b) != "/workspace/repos/second/app" {
		t.Fatal("repository basenames collided")
	}
	a.Role = "extra"
	c.Repositories = []Repository{a}
	if RepositoryPath(c, a) != "/workspace/repos/first/app" {
		t.Fatal("extra checkout can collide with setup output")
	}
}
