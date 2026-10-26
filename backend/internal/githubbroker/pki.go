package githubbroker

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

// PKI is a tiny host-side certificate authority used to give the broker a
// TLS identity that agent containers can trust. gh requires HTTPS for
// enterprise-style hosts, so the broker serves TLS; the CA certificate is
// installed into the agent image while the CA key stays host-side.
type PKI struct {
	CACertPath string
	CAKeyPath  string
	CertPath   string
	KeyPath    string
}

// EnsurePKI loads or creates a CA and broker server certificate in dir. The
// directory must stay outside agent containers; only the CA certificate is
// copied into the agent image.
func EnsurePKI(dir string, hosts []string) (*PKI, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	p := &PKI{
		CACertPath: filepath.Join(dir, "ca.pem"),
		CAKeyPath:  filepath.Join(dir, "ca-key.pem"),
		CertPath:   filepath.Join(dir, "server.pem"),
		KeyPath:    filepath.Join(dir, "server-key.pem"),
	}
	if fileExists(p.CACertPath) && fileExists(p.CAKeyPath) &&
		fileExists(p.CertPath) && fileExists(p.KeyPath) {
		if fresh, err := certFresh(p.CertPath); err == nil && fresh {
			return p, nil
		}
		// Certificates are short-lived probe artifacts; regenerate.
		for _, path := range []string{p.CACertPath, p.CAKeyPath, p.CertPath, p.KeyPath} {
			if err := os.Remove(path); err != nil {
				return nil, err
			}
		}
	}
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		return nil, err
	}
	caTpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "Flora probe broker CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTpl, caTpl, &caKey.PublicKey, caKey)
	if err != nil {
		return nil, err
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		return nil, err
	}
	srvKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, err = rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		return nil, err
	}
	srvTpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "flora-broker"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			srvTpl.IPAddresses = append(srvTpl.IPAddresses, ip)
		} else {
			srvTpl.DNSNames = append(srvTpl.DNSNames, h)
		}
	}
	srvDER, err := x509.CreateCertificate(rand.Reader, srvTpl, caCert, &srvKey.PublicKey, caKey)
	if err != nil {
		return nil, err
	}
	write := func(path string, pemType string, der []byte) error {
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
		if err != nil {
			return err
		}
		defer f.Close()
		return pem.Encode(f, &pem.Block{Type: pemType, Bytes: der})
	}
	caKeyDER, err := x509.MarshalECPrivateKey(caKey)
	if err != nil {
		return nil, err
	}
	srvKeyDER, err := x509.MarshalECPrivateKey(srvKey)
	if err != nil {
		return nil, err
	}
	if err := write(p.CACertPath, "CERTIFICATE", caDER); err != nil {
		return nil, err
	}
	if err := write(p.CAKeyPath, "EC PRIVATE KEY", caKeyDER); err != nil {
		return nil, err
	}
	if err := write(p.CertPath, "CERTIFICATE", srvDER); err != nil {
		return nil, err
	}
	if err := write(p.KeyPath, "EC PRIVATE KEY", srvKeyDER); err != nil {
		return nil, err
	}
	if err := os.Chmod(p.CACertPath, 0o644); err != nil {
		return nil, fmt.Errorf("publish CA certificate: %w", err)
	}
	return p, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// certFresh reports whether the certificate at path parses and is valid for
// at least another hour.
func certFresh(path string) (bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return false, fmt.Errorf("no PEM block in %s", path)
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false, err
	}
	return time.Until(cert.NotAfter) > time.Hour, nil
}
