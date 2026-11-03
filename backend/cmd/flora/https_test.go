package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/acme"
	"golang.org/x/crypto/acme/autocert"
)

const browserDomain = "flora.example.com"

// issueBrowserCertificate exercises the production autocert configuration with a
// local ACME authority. The authority fetches the real HTTP-01 response before
// signing the client's CSR. There is no insecure production switch or fake cache.
func issueBrowserCertificate(t *testing.T, cache string) *x509.CertPool {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTemplate := &x509.Certificate{SerialNumber: serial(), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(1, 0, 0)}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(ca)
	var mu sync.Mutex
	validated := false
	var certificate []byte
	var thumbprint, base, challengeURL string
	encode := base64.RawURLEncoding
	authority := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Replay-Nonce", fmt.Sprint(time.Now().UnixNano()))
		w.Header().Set("Content-Type", "application/json")
		reply := func(status int, value any) { w.WriteHeader(status); _ = json.NewEncoder(w).Encode(value) }
		if r.Method == "HEAD" {
			w.WriteHeader(200)
			return
		}
		if r.Method == "GET" {
			reply(200, map[string]string{"newNonce": base + "/nonce", "newAccount": base + "/account", "newOrder": base + "/order"})
			return
		}
		var jws struct{ Protected, Payload, Signature string }
		if err := json.NewDecoder(r.Body).Decode(&jws); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		payload, err := encode.DecodeString(jws.Payload)
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		var input map[string]json.RawMessage
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, &input); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
		}
		switch r.URL.Path {
		case "/account":
			protected, _ := encode.DecodeString(jws.Protected)
			var header struct {
				JWK json.RawMessage `json:"jwk"`
			}
			if err := json.Unmarshal(protected, &header); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			var canonical bytes.Buffer
			if err := json.Compact(&canonical, header.JWK); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			hash := sha256.Sum256(canonical.Bytes())
			thumbprint = encode.EncodeToString(hash[:])
			w.Header().Set("Location", base+"/account/1")
			reply(201, map[string]any{"status": "valid"})
		case "/order", "/order/1":
			status := "pending"
			if validated {
				status = "ready"
			}
			if certificate != nil {
				status = "valid"
			}
			order := map[string]any{"status": status, "identifiers": []any{map[string]string{"type": "dns", "value": browserDomain}}, "authorizations": []string{base + "/authz"}, "finalize": base + "/finalize"}
			if certificate != nil {
				order["certificate"] = base + "/certificate"
			}
			w.Header().Set("Location", base+"/order/1")
			code := 200
			if r.URL.Path == "/order" {
				code = 201
			}
			reply(code, order)
		case "/authz":
			status := "pending"
			if validated {
				status = "valid"
			}
			reply(200, map[string]any{"status": status, "identifier": map[string]string{"type": "dns", "value": browserDomain}, "challenges": []any{map[string]string{"type": "http-01", "url": base + "/challenge", "token": "test-token", "status": status}}})
		case "/challenge":
			req, _ := http.NewRequest("GET", challengeURL+"/.well-known/acme-challenge/test-token", nil)
			req.Host = browserDomain
			response, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			body, err := io.ReadAll(response.Body)
			_ = response.Body.Close()
			if err != nil || response.StatusCode != 200 || string(body) != "test-token."+thumbprint {
				t.Errorf("HTTP-01 validation failed: status=%d body=%q", response.StatusCode, body)
				w.WriteHeader(400)
				return
			}
			validated = true
			reply(200, map[string]string{"type": "http-01", "status": "valid", "url": base + "/challenge", "token": "test-token"})
		case "/finalize":
			if !validated {
				t.Error("signing before challenge validation")
				w.WriteHeader(400)
				return
			}
			var csr64 string
			_ = json.Unmarshal(input["csr"], &csr64)
			der, _ := encode.DecodeString(csr64)
			csr, err := x509.ParseCertificateRequest(der)
			if err != nil || csr.CheckSignature() != nil {
				t.Error("invalid CSR")
				w.WriteHeader(400)
				return
			}
			leaf := &x509.Certificate{SerialNumber: serial(), DNSNames: csr.DNSNames, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(90 * 24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
			der, err = x509.CreateCertificate(rand.Reader, leaf, ca, csr.PublicKey, caKey)
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			certificate = append(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})...)
			reply(200, map[string]string{"status": "valid", "certificate": base + "/certificate"})
		case "/certificate":
			w.Header().Set("Content-Type", "application/pem-certificate-chain")
			_, _ = w.Write(certificate)
		default:
			t.Errorf("unexpected ACME path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer authority.Close()
	base = authority.URL
	manager := &autocert.Manager{Client: &acme.Client{DirectoryURL: base + "/directory"}}
	plain, secure, err := publicServers(browserDomain, cache, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "browser") }), manager)
	if err != nil {
		t.Fatal(err)
	}
	challenge := httptest.NewServer(plain.Handler)
	defer challenge.Close()
	challengeURL = challenge.URL
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer secure.Close()
	go func() { _ = secure.ServeTLS(listener, "", "") }()
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 15 * time.Second}, "tcp", listener.Addr().String(), &tls.Config{RootCAs: pool, ServerName: browserDomain})
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.Close()
	mu.Lock()
	if !validated || certificate == nil {
		t.Error("certificate obtained without HTTP-01")
	}
	mu.Unlock()
	return pool
}

func TestAutomaticHTTPS(t *testing.T) {
	cache := filepath.Join(t.TempDir(), "certificates")
	roots := issueBrowserCertificate(t, cache)
	// A fresh manager must use persisted keys/certificates with no ACME network.
	manager := &autocert.Manager{Client: &acme.Client{DirectoryURL: "http://127.0.0.1:1/unavailable"}}
	_, secure, err := publicServers(browserDomain, cache, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/events" {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: live\n\n")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		_, _ = io.WriteString(w, "browser")
	}), manager)
	if err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer secure.Close()
	go func() { _ = secure.ServeTLS(l, "", "") }()
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, ServerName: browserDomain}, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", l.Addr().String())
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	sseCtx, cancelSSE := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelSSE()
	sseRequest, _ := http.NewRequestWithContext(sseCtx, "GET", "https://"+browserDomain+"/events", nil)
	sse, err := client.Do(sseRequest)
	if err != nil {
		t.Fatal(err)
	}
	first := make([]byte, len("data: live\n\n"))
	if _, err := io.ReadFull(sse.Body, first); err != nil || string(first) != "data: live\n\n" {
		t.Fatal("TLS buffered live SSE", err)
	}
	_ = sse.Body.Close()
	for _, test := range []struct {
		host   string
		status int
	}{{browserDomain, 200}, {brokerName, 421}, {"attacker.example.com", 421}} {
		req, _ := http.NewRequest("GET", "https://"+test.host+"/", nil)
		r, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = r.Body.Close()
		if r.StatusCode != test.status {
			t.Errorf("host %s: %d", test.host, r.StatusCode)
		}
	}
	conn, err := tls.Dial("tcp", l.Addr().String(), &tls.Config{RootCAs: roots, ServerName: brokerName})
	if conn != nil {
		_ = conn.Close()
	}
	if err == nil {
		t.Error("public socket accepted private broker SNI")
	}
	_ = filepath.WalkDir(cache, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			t.Fatal(err)
		}
		info, err := entry.Info()
		if err != nil {
			t.Fatal(err)
		}
		want := os.FileMode(0600)
		if entry.IsDir() {
			want = 0700
		}
		if info.Mode().Perm() != want {
			t.Errorf("%s has mode %o", path, info.Mode().Perm())
		}
		return nil
	})
}

func TestDomainAndHostIsolation(t *testing.T) {
	for _, name := range []string{"*.example.com", "https://example.com", "example.com:443", "a..com", "a.test", "a.internal", "a.local", "127.0.0.1", "a.com/path"} {
		if _, err := domainName(name); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
	if name, err := domainName("Flora.Example.COM"); err != nil || name != browserDomain {
		t.Fatal(name, err)
	}
	handler := onlyHost(browserDomain, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, host := range []string{browserDomain, brokerName} {
		req := httptest.NewRequest("GET", "https://"+host+"/", nil)
		req.TLS = &tls.ConnectionState{ServerName: brokerName}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != 421 {
			t.Fatal("accepted broker SNI", host)
		}
	}
}

func TestPublicAddressSelection(t *testing.T) {
	assigned := map[string]bool{"10.0.0.2": true, "10.1.0.2": true, "2001:db8::2": true}
	for _, test := range []struct {
		explicit          string
		saved, candidates []string
		valid             bool
	}{
		{"", nil, []string{"10.0.0.2"}, true},
		{"", nil, []string{"10.0.0.2", "10.1.0.2"}, false},
		{"10.1.0.2,2001:db8::2", nil, nil, true},
		{"203.0.113.5", nil, nil, false},
		{"0.0.0.0", nil, nil, false},
		{"::", nil, nil, false},
		{"127.0.0.1", nil, nil, false},
		{"172.17.0.1", nil, nil, false},
		{"10.0.0.2,10.0.0.2", nil, nil, false},
		{"", []string{"10.0.0.2"}, []string{"10.0.0.2", "10.1.0.2"}, true},
	} {
		if _, err := selectPublicAddresses(test.explicit, test.saved, assigned, test.candidates); (err == nil) != test.valid {
			t.Errorf("%+v: %v", test, err)
		}
	}
}

func TestHTTPSIPv6(t *testing.T) {
	l, err := net.Listen("tcp6", "[::1]:0")
	if err != nil {
		t.Skipf("IPv6 unavailable: %v", err)
	}
	defer l.Close()
	cache := filepath.Join(t.TempDir(), "certificates")
	roots := issueBrowserCertificate(t, cache)
	_, secure, err := publicServers(browserDomain, cache, http.NotFoundHandler(), &autocert.Manager{})
	if err != nil {
		t.Fatal(err)
	}
	defer secure.Close()
	go func() { _ = secure.ServeTLS(l, "", "") }()
	conn, err := tls.Dial("tcp", l.Addr().String(), &tls.Config{RootCAs: roots, ServerName: browserDomain})
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.Close()
}

func TestPrivateBrokerTrust(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	public, ca, key, err := brokerAuthority(dir)
	if err != nil {
		t.Fatal(err)
	}
	public2, _, _, err := brokerAuthority(dir)
	if err != nil || !bytes.Equal(public, public2) {
		t.Fatal("CA rotated on restart", err)
	}
	cfg := brokerTLS(ca, key)
	cert, err := cfg.GetCertificate(&tls.ClientHelloInfo{ServerName: brokerName})
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(public)
	if _, err := cert.Leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: brokerName}); err != nil {
		t.Fatal(err)
	}
	if _, err := cfg.GetCertificate(&tls.ClientHelloInfo{ServerName: browserDomain}); err == nil {
		t.Error("broker accepted browser SNI")
	}
	cert.Leaf.NotAfter = time.Now() // force the production renewal branch
	renewed, err := cfg.GetCertificate(&tls.ClientHelloInfo{ServerName: brokerName})
	if err != nil || bytes.Equal(cert.Certificate[0], renewed.Certificate[0]) {
		t.Fatal("private leaf was not renewed", err)
	}
	if _, err := renewed.Leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: brokerName}); err != nil {
		t.Fatal("renewal changed private trust", err)
	}
	if strings.Contains(string(public), "PRIVATE KEY") {
		t.Error("private key in container trust")
	}
	hash, err := deploymentEnrollment(dir)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(hash)
	_, err = deploymentEnrollment(dir)
	after, _ := os.ReadFile(hash)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("enrollment changed on restart", err)
	}
	if err := os.Chmod(filepath.Join(dir, "broker-ca.pem"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := brokerAuthority(dir); err == nil {
		t.Error("accepted world-readable CA key")
	}
}
