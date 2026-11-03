package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/docker"
)

const brokerName = "flora-github.internal"

type deployment struct {
	Domain    string
	Owner     string
	NetworkID string
	Gateway   string
	Addresses []string
	CAHash    string
	AgentUID  int
	AgentGID  int
}

// prepareDeployment persists only app-owned network identity. Missing recorded
// networks fail closed, since saved containers still refer to their original ID.
// Docker allocates the subnet from its configured address pools. No daemon,
// host DNS, firewall, package or service settings are changed.
func prepareDeployment(ctx context.Context, engine *docker.Client, dir, domain, bindings string) (deployment, string, error) {
	var d deployment
	if runtime.GOOS != "linux" {
		return d, "", errors.New("-hostname deployment requires Linux and a local rootful Docker Engine; use manual flags for development")
	}
	if err := engine.Ping(ctx); err != nil {
		return d, "", fmt.Errorf("Docker must already be installed and accessible at the configured local socket (API %s): %w", docker.APIVersion, err)
	}
	if err := engine.CheckLocalRuntime(ctx); err != nil {
		return d, "", fmt.Errorf("Docker runtime prerequisite: %w", err)
	}
	if err := privateDir(dir); err != nil {
		return d, "", err
	}
	statePath := filepath.Join(dir, "deployment.json")
	data, err := privateRead(statePath)
	if err == nil {
		if err := json.Unmarshal(data, &d); err != nil || d.Domain != domain || len(d.Owner) != 48 {
			return d, "", errors.New("saved deployment is invalid or has a different hostname; restore it rather than replacing saved network/trust")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return d, "", err
	} else {
		d.Domain = domain
		d.AgentUID, d.AgentGID = os.Geteuid(), os.Getegid()
		if d.AgentUID == 0 {
			// Only per-chat bind mounts use this identity. The storage root and
			// all host credentials remain private to the application process.
			d.AgentUID, d.AgentGID = 1000, 1000
		} else if d.AgentGID == 0 {
			d.AgentGID = d.AgentUID
		}
		d.Owner, err = docker.NewPassword()
		if err != nil {
			return d, "", err
		}
		if err := saveJSON(statePath, d); err != nil {
			return d, "", err
		}
	}
	if d.AgentUID <= 0 || d.AgentGID <= 0 {
		return d, "", errors.New("saved deployment has no non-root agent identity; restore it before starting chats")
	}
	addresses, err := publicAddresses(bindings, d.Addresses)
	if err != nil {
		return d, "", err
	}
	if len(d.Addresses) > 0 && !slices.Equal(addresses, d.Addresses) {
		return d, "", errors.New("-public-listen differs from saved deployment; restore the recorded NIC addresses")
	}
	d.Addresses = addresses
	name := "flora-" + d.Owner[:12]
	lookup := d.NetworkID
	if lookup == "" {
		lookup = name
	}
	n, err := engine.NetworkInspect(ctx, lookup)
	if docker.IsNotFound(err) && d.NetworkID == "" {
		id, e := engine.NetworkCreate(ctx, name, d.Owner)
		if e != nil {
			return d, "", fmt.Errorf("create owned Docker bridge: %w", e)
		}
		n, err = engine.NetworkInspect(ctx, id)
	}
	if err != nil {
		return d, "", fmt.Errorf("restore the recorded Docker bridge; it will not be recreated under saved chats: %w", err)
	}
	if n.Name != name || n.Labels["flora.deployment"] != d.Owner || n.Driver != "bridge" || n.Internal || len(n.Gateways) != 1 || net.ParseIP(n.Gateways[0]).To4() == nil || n.Bridge == "" || d.Gateway != "" && d.Gateway != n.Gateways[0] {
		return d, "", errors.New("owned bridge identity/configuration differs; refusing to adopt a foreign network")
	}
	d.NetworkID, d.Gateway = n.ID, n.Gateways[0]
	if err := saveJSON(statePath, d); err != nil {
		return d, "", err
	}
	return d, n.Bridge, nil
}

// Select one unambiguous local IPv4 address. An explicit list also supports IPv6
// and multi-homed hosts. Never bind wildcard sockets or infer a local IP from
// public DNS, which often points to an unassigned address behind cloud NAT.
func publicAddresses(explicit string, saved []string) ([]string, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	assigned, candidates := map[string]bool{}, []string{}
	for _, nic := range interfaces {
		if nic.Flags&net.FlagUp == 0 || nic.Flags&net.FlagLoopback != 0 {
			continue
		}
		if _, err := os.Stat(filepath.Join("/sys/class/net", nic.Name, "bridge")); err == nil {
			continue
		}
		addresses, err := nic.Addrs()
		if err != nil {
			return nil, err
		}
		for _, address := range addresses {
			ip, _, err := net.ParseCIDR(address.String())
			if err != nil || !ip.IsGlobalUnicast() {
				continue
			}
			assigned[ip.String()] = true
			if ip.To4() != nil && nic.Flags&net.FlagPointToPoint == 0 && !strings.HasPrefix(nic.Name, "veth") && !strings.HasPrefix(nic.Name, "docker") {
				candidates = append(candidates, ip.String())
			}
		}
	}
	selected := saved
	if explicit != "" {
		selected = strings.Split(explicit, ",")
	} else if len(selected) == 0 {
		if len(candidates) != 1 {
			return nil, errors.New("ambiguous public NIC; set -public-listen to comma-separated assigned local IPs (not the NAT public IP)")
		}
		selected = candidates
	}
	seen := map[string]bool{}
	for _, address := range selected {
		if !assigned[address] || seen[address] {
			return nil, errors.New("-public-listen must contain distinct assigned local NIC IPs, never wildcard, loopback or bridge addresses")
		}
		seen[address] = true
	}
	return selected, nil
}

func saveJSON(path string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return privateWrite(path, b)
}

func privateWrite(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".flora-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func privateRead(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		return nil, fmt.Errorf("%s must be a private regular 0600 file", path)
	}
	return os.ReadFile(path)
}

// Only the public CA leaves this private directory. Existing manual deployments
// keep their supplied trust files; automatic mode never imports or rotates them.
func brokerAuthority(dir string) ([]byte, *x509.Certificate, *ecdsa.PrivateKey, error) {
	path := filepath.Join(dir, "broker-ca.pem")
	data, err := privateRead(path)
	if errors.Is(err, os.ErrNotExist) {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, nil, nil, err
		}
		template := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: "Flora private broker CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(10, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
		der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
		if err != nil {
			return nil, nil, nil, err
		}
		keyDER, err := x509.MarshalECPrivateKey(key)
		if err != nil {
			return nil, nil, nil, err
		}
		data = append(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})...)
		if err := privateWrite(path, data); err != nil {
			return nil, nil, nil, err
		}
	} else if err != nil {
		return nil, nil, nil, err
	}
	pair, err := tls.X509KeyPair(data, data)
	if err != nil {
		return nil, nil, nil, errors.New("private broker CA damaged; restore saved trust, do not generate a replacement")
	}
	ca, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil || !ca.IsCA || time.Until(ca.NotAfter) < 90*24*time.Hour {
		return nil, nil, nil, errors.New("broker CA invalid or expires within 90 days; retained chats need an explicit trust migration")
	}
	key, ok := pair.PrivateKey.(*ecdsa.PrivateKey)
	if !ok {
		return nil, nil, nil, errors.New("invalid broker CA key")
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ca.Raw}), ca, key, nil
}

func serial() *big.Int {
	n, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	return n
}

// Issue short-lived leaves under the same persisted CA without a timer, helper
// process or application restart. Containers retain the same public CA trust.
func brokerTLS(ca *x509.Certificate, key *ecdsa.PrivateKey) *tls.Config {
	var cert *tls.Certificate
	// GetCertificate may run concurrently for different containers.
	var lock sync.Mutex
	return &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: func(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
		if hello.ServerName != brokerName {
			return nil, errors.New("unrecognized broker SNI")
		}
		lock.Lock()
		defer lock.Unlock()
		if cert != nil && time.Until(cert.Leaf.NotAfter) > 24*time.Hour {
			return cert, nil
		}
		leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, err
		}
		leaf := &x509.Certificate{SerialNumber: serial(), DNSNames: []string{brokerName}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(7 * 24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
		der, err := x509.CreateCertificate(rand.Reader, leaf, ca, &leafKey.PublicKey, key)
		if err != nil {
			return nil, err
		}
		parsed, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, err
		}
		cert = &tls.Certificate{Certificate: [][]byte{der}, PrivateKey: leafKey, Leaf: parsed}
		return cert, nil
	}}
}

func deploymentEnrollment(dir string) (string, error) {
	path := filepath.Join(dir, "enrollment-code")
	code, err := privateRead(path)
	if errors.Is(err, os.ErrNotExist) {
		token, err := docker.NewPassword()
		if err != nil {
			return "", err
		}
		code = []byte(token)
		if err := privateWrite(path, code); err != nil {
			return "", err
		}
		// Never print enrollment secrets into stdout, stderr or a service journal.
		if tty, err := os.OpenFile("/dev/tty", os.O_WRONLY, 0); err == nil {
			_, _ = fmt.Fprintf(tty, "Flora one-time administrator enrollment code: %s\n", code)
			_ = tty.Close()
		}
	} else if err != nil {
		return "", err
	}
	if len(code) != 48 {
		return "", errors.New("saved enrollment code damaged")
	}
	hashPath := filepath.Join(dir, "enrollment.sha256")
	return hashPath, privateWrite(hashPath, []byte(auth.TokenHash(string(code))))
}
