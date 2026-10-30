.PHONY: deps web build build-linux check smoke browser

export GOTOOLCHAIN := local

deps:
	npm ci
	go -C backend mod download

web:
	npm run build

build: web
	mkdir -p bin
	CGO_ENABLED=0 go -C backend build -mod=readonly -trimpath -o ../bin/flora ./cmd/flora

build-linux: web
	mkdir -p bin
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go -C backend build -mod=readonly -trimpath -o ../bin/flora-linux-amd64 ./cmd/flora
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go -C backend build -mod=readonly -trimpath -o ../bin/flora-linux-arm64 ./cmd/flora

check: web
	npm run check
	test -z "$$(gofmt -l backend)"
	CGO_ENABLED=0 go -C backend vet ./...
	CGO_ENABLED=0 go -C backend test -mod=readonly ./...

smoke: build
	node --test scripts/smoke.test.mjs

browser: web
	FLORA_CHAT_BROWSER_TEST=1 go -C backend test -mod=readonly -count=1 -run TestChatBrowser ./internal/server
