package storagemanager

import (
	"bytes"
	"strings"
	"testing"
)

func TestSanitizeBucketName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"MeuProjeto", "meuprojeto"},
		{"Meu Projeto_Assets", "meu-projeto-assets"},
		{"..invalid!!bucket..", "invalid-bucket"},
		{"ab", "app-ab"},
		{"valid-bucket-name-123", "valid-bucket-name-123"},
	}

	for _, tt := range tests {
		got := SanitizeBucketName(tt.input)
		if got != tt.expected {
			t.Errorf("SanitizeBucketName(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		bytes    int64
		expected string
	}{
		{500, "500 B"},
		{1024, "1.0 KB"},
		{1048576, "1.0 MB"},
		{1073741824, "1.0 GB"},
	}

	for _, tt := range tests {
		got := FormatBytes(tt.bytes)
		if got != tt.expected {
			t.Errorf("FormatBytes(%d) = %q; want %q", tt.bytes, got, tt.expected)
		}
	}
}

func TestGenerateAccessKeys(t *testing.T) {
	ak, sk := GenerateAccessKeys()
	if !strings.HasPrefix(ak, "vpsql_ak_") {
		t.Errorf("expected ak to start with vpsql_ak_, got %s", ak)
	}
	if !strings.HasPrefix(sk, "vpsql_sk_") {
		t.Errorf("expected sk to start with vpsql_sk_, got %s", sk)
	}
	if len(ak) < 20 || len(sk) < 40 {
		t.Errorf("keys too short: ak=%d, sk=%d", len(ak), len(sk))
	}
}

func TestHmacSHA256(t *testing.T) {
	key := []byte("secret")
	data := []byte("message")
	h1 := hmacSHA256(key, data)
	h2 := hmacSHA256(key, data)
	if !bytes.Equal(h1, h2) {
		t.Errorf("expected deterministic HMAC SHA256")
	}
}
