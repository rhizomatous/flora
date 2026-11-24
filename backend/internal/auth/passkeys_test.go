package auth

import "testing"

func TestCanonicalPasskeyConfiguration(t *testing.T) {
	for _, origin := range []string{"https://flora.example.com", "https://flora.example.com:8443", "https://localhost:8443"} {
		w, err := NewWebAuthn(origin)
		if err != nil {
			t.Fatal(origin, err)
		}
		want := "flora.example.com"
		if origin == "https://localhost:8443" {
			want = "localhost"
		}
		if w.Config.RPID != want || len(w.Config.RPOrigins) != 1 || w.Config.RPOrigins[0] != origin || w.Config.AuthenticatorSelection.UserVerification != "required" || w.Config.RPAllowCrossOrigin {
			t.Fatal(w.Config)
		}
	}
	for _, origin := range []string{"http://flora.test", "https://127.0.0.1", "https://[::1]", "https://Flora.test", "https://flora.test/path", "https://user@flora.test", "https://flora.test?x=1", "https://flora.test#fragment"} {
		if _, err := NewWebAuthn(origin); err == nil {
			t.Fatalf("accepted incompatible origin %s", origin)
		}
	}
}
