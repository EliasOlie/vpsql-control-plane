package backupmanager

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/vpsql/api/internal/config"
	"github.com/vpsql/api/internal/models"
)

type S3Uploader struct {
	enabled        bool
	endpoint       string
	bucket         string
	region         string
	accessKey      string
	secretKey      string
	forcePathStyle bool
	httpClient     *http.Client
}

func NewS3Uploader(cfg *config.Config) *S3Uploader {
	return &S3Uploader{
		enabled:        cfg.S3Enabled,
		endpoint:       strings.TrimRight(cfg.S3Endpoint, "/"),
		bucket:         strings.TrimSpace(cfg.S3Bucket),
		region:         strings.TrimSpace(cfg.S3Region),
		accessKey:      strings.TrimSpace(cfg.S3AccessKey),
		secretKey:      strings.TrimSpace(cfg.S3SecretKey),
		forcePathStyle: cfg.S3ForcePathStyle,
		httpClient: &http.Client{
			Timeout: 10 * time.Minute,
		},
	}
}

func (u *S3Uploader) IsEnabled() bool {
	return u.enabled && u.endpoint != "" && u.bucket != "" && u.accessKey != "" && u.secretKey != ""
}

func (u *S3Uploader) GetInfo() models.S3ConfigInfo {
	masked := ""
	if len(u.accessKey) > 8 {
		masked = u.accessKey[:4] + "••••" + u.accessKey[len(u.accessKey)-4:]
	} else if u.accessKey != "" {
		masked = "••••••••"
	}

	status := "ready_plug_and_play"
	if u.IsEnabled() {
		status = "connected"
	} else if u.endpoint != "" || u.bucket != "" {
		status = "configured_disabled"
	}

	return models.S3ConfigInfo{
		Enabled:         u.enabled,
		Endpoint:        u.endpoint,
		Bucket:          u.bucket,
		Region:          u.region,
		AccessKeyMasked: masked,
		Status:          status,
	}
}

// Upload sends a local backup file to Cloudflare R2 / AWS S3 using AWS SigV4
func (u *S3Uploader) Upload(ctx context.Context, localFilePath, remoteFileName string) error {
	if !u.IsEnabled() {
		// S3 upload is not enabled or not fully configured; skip gracefully (plug & play ready)
		return nil
	}

	data, err := os.ReadFile(localFilePath)
	if err != nil {
		return fmt.Errorf("failed to read local backup for S3 upload: %w", err)
	}

	endpointURL, err := url.Parse(u.endpoint)
	if err != nil {
		return fmt.Errorf("invalid S3 endpoint URL: %w", err)
	}

	host := endpointURL.Host
	var requestURL string
	var canonicalURI string

	if u.forcePathStyle || endpointURL.Path != "" {
		// Path style: https://endpoint/bucket/filename (e.g. Cloudflare R2: https://<account_id>.r2.cloudflarestorage.com/<bucket>/<filename>)
		basePath := strings.TrimRight(endpointURL.Path, "/")
		canonicalURI = fmt.Sprintf("%s/%s/%s", basePath, u.bucket, remoteFileName)
		requestURL = fmt.Sprintf("%s://%s%s", endpointURL.Scheme, host, canonicalURI)
	} else {
		// Virtual host style: https://bucket.endpoint/filename
		host = fmt.Sprintf("%s.%s", u.bucket, host)
		canonicalURI = "/" + remoteFileName
		requestURL = fmt.Sprintf("%s://%s%s", endpointURL.Scheme, host, canonicalURI)
	}

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	// Payload SHA256
	payloadHashBytes := sha256.Sum256(data)
	payloadHash := hex.EncodeToString(payloadHashBytes[:])

	// Canonical headers
	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n", host, payloadHash, amzDate)
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"

	// Canonical request
	canonicalRequest := strings.Join([]string{
		"PUT",
		canonicalURI,
		"",
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")

	// String to sign
	canonicalRequestHash := sha256Hex([]byte(canonicalRequest))
	region := u.region
	if region == "" {
		region = "auto"
	}
	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, region)
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		canonicalRequestHash,
	}, "\n")

	// Signature calculation
	kDate := hmacSHA256([]byte("AWS4"+u.secretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte("s3"))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))
	signature := hex.EncodeToString(hmacSHA256(kSigning, []byte(stringToSign)))

	// Build HTTP PUT request
	req, err := http.NewRequestWithContext(ctx, "PUT", requestURL, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create S3 request: %w", err)
	}

	req.Header.Set("Host", host)
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)
	req.Header.Set("Content-Type", "application/gzip")
	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		u.accessKey, credentialScope, signedHeaders, signature,
	))

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to upload backup to S3: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("S3 upload returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

func sha256Hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}
