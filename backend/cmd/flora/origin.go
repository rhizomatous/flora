package main

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

var errPublicOrigin = errors.New("public URL must be an HTTPS origin with a valid hostname and port")

// publicOrigin matches browser Origin serialization: lowercase DNS names,
// canonical IP literals, and no default HTTPS port. DNS names must be ASCII
// (punycode for international names); ambiguous legacy IPv4 forms are rejected.
func publicOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || (u.EscapedPath() != "" && u.EscapedPath() != "/") || u.ForceQuery || u.RawQuery != "" || strings.Contains(raw, "#") {
		return "", errPublicOrigin
	}
	host := strings.ToLower(u.Hostname())
	if addr, err := netip.ParseAddr(host); err == nil {
		if addr.Zone() != "" || addr.Is6() != strings.HasPrefix(u.Host, "[") {
			return "", errPublicOrigin
		}
		host = addr.String()
		if addr.Is4In6() {
			b := addr.As16()
			host = fmt.Sprintf("::ffff:%x:%x", uint16(b[12])<<8|uint16(b[13]), uint16(b[14])<<8|uint16(b[15]))
		}
	} else if !dnsHostname(host) || strings.ContainsAny(u.Host, "[]") {
		return "", errPublicOrigin
	}
	port := u.Port()
	if port == "" && strings.HasSuffix(u.Host, ":") {
		return "", errPublicOrigin
	}
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", errPublicOrigin
		}
		port = strconv.Itoa(n)
		if port == "443" {
			port = ""
		}
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return "https://" + host, nil
}

func dnsHostname(host string) bool {
	host = strings.TrimSuffix(host, ".")
	if len(host) == 0 || len(host) > 253 {
		return false
	}
	labels := strings.Split(host, ".")
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	// Browsers interpret a numeric final label as an IPv4 address, including
	// shortened, octal, and hexadecimal forms that netip deliberately rejects.
	last := labels[len(labels)-1]
	return strings.Trim(last, "0123456789") != "" && !(strings.HasPrefix(last, "0x") && strings.Trim(last[2:], "0123456789abcdef") == "")
}
