package main

import (
	"strings"
	"testing"
)

func TestPublicOrigin(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"https://FLORA.Example.COM:443/", "https://flora.example.com"},
		{"HTTPS://FLORA.Example.COM:00443", "https://flora.example.com"},
		{"https://FLORA.Example.COM:8443", "https://flora.example.com:8443"},
		{"https://localhost:08443/", "https://localhost:8443"},
		{"https://127.0.0.1:443", "https://127.0.0.1"},
		{"https://127.0.0.1:8443", "https://127.0.0.1:8443"},
		{"https://[2001:0DB8:0:0::1]:443/", "https://[2001:db8::1]"},
		{"https://[2001:DB8::1]:8443", "https://[2001:db8::1]:8443"},
		{"https://[::1]", "https://[::1]"},
		{"https://[::ffff:192.0.2.1]:8443", "https://[::ffff:c000:201]:8443"},
		{"https://flora.example./", "https://flora.example."},
		{"https://xn--bcher-kva.example", "https://xn--bcher-kva.example"},
	} {
		t.Run(tc.input, func(t *testing.T) {
			got, err := publicOrigin(tc.input)
			if err != nil || got != tc.want {
				t.Fatalf("origin=%q err=%v, want %q", got, err, tc.want)
			}
		})
	}
}

func TestPublicOriginRejectsInvalidURLs(t *testing.T) {
	for _, input := range []string{
		"", "http://flora.test", "https:flora.test", "https:///flora.test", "https://",
		"https://flora.test/path", "https://flora.test/%2f", "https://flora.test?", "https://flora.test?a=b",
		"https://flora.test#", "https://flora.test#fragment", "https://user:secret@flora.test",
		"https://flora.test:", "https://flora.test:0", "https://flora.test:65536", "https://flora.test:-1", "https://flora.test:bad",
		"https://flora.test\\evil", "https://flora.test\n", "https://flora%2etest", "https://flora_test",
		"https://.flora.test", "https://flora..test", "https://-flora.test", "https://flora-.test", "https://bücher.example",
		"https://" + strings.Repeat("a", 64) + ".example", "https://" + strings.Repeat("abcd.", 60) + "example.example",
		"https://[::1", "https://::1", "https://[not-ipv6]", "https://[127.0.0.1]", "https://[fe80::1%25en0]",
		"https://127.1", "https://0177.0.0.1", "https://0x7f000001", "https://2130706433", "https://999.999.999.999",
	} {
		t.Run(input, func(t *testing.T) {
			if origin, err := publicOrigin(input); err == nil {
				t.Fatalf("accepted invalid origin %q", origin)
			}
		})
	}
}
