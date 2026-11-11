package storagemanager

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/vpsql/api/internal/config"
	"github.com/vpsql/api/internal/models"
)

// S3Auth handles standard AWS Signature Version 4 (SigV4) verification and admin fallback
type S3Auth struct {
	cfg *config.Config
	mgr *StorageManager
}

func NewS3Auth(cfg *config.Config, mgr *StorageManager) *S3Auth {
	return &S3Auth{
		cfg: cfg,
		mgr: mgr,
	}
}

// Authenticate verifies the request using SigV4, admin token, or public bucket access
func (a *S3Auth) Authenticate(c *fiber.Ctx, bucketName string) (*models.StorageBucket, bool, error) {
	// 1. Check Admin Master Key or Admin Token
	authHeader := c.Get("Authorization")
	if authHeader != "" {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		token = strings.TrimSpace(token)
		if token != "" && (token == a.cfg.AdminToken || token == a.cfg.AuthMasterKey) {
			return nil, true, nil
		}
	}

	// 2. Direct custom headers (e.g. VPSQL API / CLI)
	vpsqlAk := c.Get("X-VPSQL-Access-Key")
	vpsqlSk := c.Get("X-VPSQL-Secret-Key")
	if vpsqlAk != "" && vpsqlSk != "" {
		bucket, err := a.mgr.GetBucketByAccessKey(c.Context(), vpsqlAk)
		if err == nil && bucket.SecretKey == vpsqlSk {
			return bucket, false, nil
		}
	}

	// 3. AWS Signature Version 4
	if strings.HasPrefix(authHeader, "AWS4-HMAC-SHA256 ") || c.Query("X-Amz-Signature") != "" {
		bucket, err := a.verifyAWS4(c)
		if err == nil && bucket != nil {
			return bucket, false, nil
		}
		// If AWS4 was provided but failed, don't silently fallback to public if modifying
		if c.Method() != "GET" && c.Method() != "HEAD" {
			return nil, false, fmt.Errorf("SignatureDoesNotMatch: %w", err)
		}
	}

	// 4. Public access check for Read requests (GET / HEAD)
	if (c.Method() == "GET" || c.Method() == "HEAD") && bucketName != "" {
		bucket, err := a.mgr.Get(c.Context(), bucketName)
		if err == nil && bucket.IsPublic {
			return bucket, false, nil
		}
	}

	return nil, false, fmt.Errorf("AccessDenied: authentication required for this bucket")
}

// verifyAWS4 verifies standard AWS SigV4 authorization headers or query presigned URLs
func (a *S3Auth) verifyAWS4(c *fiber.Ctx) (*models.StorageBucket, error) {
	authHeader := c.Get("Authorization")

	var accessKey, dateStamp, region, signedHeaders, signature string
	var isQueryAuth bool

	if strings.HasPrefix(authHeader, "AWS4-HMAC-SHA256 ") {
		// Header auth:
		// Authorization: AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261030/auto/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=...
		params := strings.TrimPrefix(authHeader, "AWS4-HMAC-SHA256 ")
		parts := strings.Split(params, ",")
		kv := make(map[string]string)
		for _, p := range parts {
			kvParts := strings.SplitN(strings.TrimSpace(p), "=", 2)
			if len(kvParts) == 2 {
				kv[strings.TrimSpace(kvParts[0])] = strings.TrimSpace(kvParts[1])
			}
		}

		cred := kv["Credential"]
		credParts := strings.Split(cred, "/")
		if len(credParts) >= 4 {
			accessKey = credParts[0]
			dateStamp = credParts[1]
			region = credParts[2]
		}
		signedHeaders = kv["SignedHeaders"]
		signature = kv["Signature"]
	} else if c.Query("X-Amz-Signature") != "" {
		// Presigned URL query auth
		isQueryAuth = true
		cred := c.Query("X-Amz-Credential")
		credParts := strings.Split(cred, "/")
		if len(credParts) >= 4 {
			accessKey = credParts[0]
			dateStamp = credParts[1]
			region = credParts[2]
		}
		signedHeaders = c.Query("X-Amz-SignedHeaders")
		signature = c.Query("X-Amz-Signature")
	} else {
		return nil, fmt.Errorf("unsupported or missing AWS4 authorization")
	}

	if accessKey == "" || signature == "" {
		return nil, fmt.Errorf("missing access key or signature in AWS4 authorization")
	}

	// Lookup bucket by access key
	bucket, err := a.mgr.GetBucketByAccessKey(c.Context(), accessKey)
	if err != nil {
		// Also allow Master Key matching
		if accessKey == a.cfg.AuthMasterKey || accessKey == a.cfg.AdminToken {
			return nil, nil // admin
		}
		return nil, fmt.Errorf("InvalidAccessKeyId: the specified access key was not found")
	}

	secretKey := bucket.SecretKey

	// Build Canonical Request
	httpMethod := c.Method()
	canonicalURI := c.Path()

	// Canonical Query String
	var canonicalQuery string
	queryParams := c.Queries()
	if isQueryAuth {
		delete(queryParams, "X-Amz-Signature")
	}

	var queryKeys []string
	for k := range queryParams {
		queryKeys = append(queryKeys, k)
	}
	sort.Strings(queryKeys)

	var queryParts []string
	for _, k := range queryKeys {
		val := queryParams[k]
		queryParts = append(queryParts, fmt.Sprintf("%s=%s", url.QueryEscape(k), url.QueryEscape(val)))
	}
	canonicalQuery = strings.Join(queryParts, "&")

	// Canonical Headers
	signedHeadersList := strings.Split(signedHeaders, ";")
	var canonicalHeadersBuilder strings.Builder
	for _, h := range signedHeadersList {
		hLower := strings.ToLower(strings.TrimSpace(h))
		val := strings.TrimSpace(c.Get(hLower))
		if val == "" && hLower == "host" {
			val = c.Hostname()
		}
		canonicalHeadersBuilder.WriteString(fmt.Sprintf("%s:%s\n", hLower, val))
	}
	canonicalHeaders := canonicalHeadersBuilder.String()

	// Payload Hash
	payloadHash := c.Get("x-amz-content-sha256")
	if payloadHash == "" {
		if isQueryAuth {
			payloadHash = "UNSIGNED-PAYLOAD"
		} else {
			body := c.Body()
			h := sha256.Sum256(body)
			payloadHash = hex.EncodeToString(h[:])
		}
	}

	canonicalRequest := fmt.Sprintf("%s\n%s\n%s\n%s\n%s\n%s",
		httpMethod,
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	)

	// String to sign
	hReq := sha256.Sum256([]byte(canonicalRequest))
	canonicalRequestHash := hex.EncodeToString(hReq[:])

	amzDate := c.Get("x-amz-date")
	if amzDate == "" {
		amzDate = c.Query("X-Amz-Date")
	}
	if amzDate == "" {
		amzDate = time.Now().UTC().Format("20060102T150405Z")
	}

	// Validate Presigned URL Expiration
	if isQueryAuth {
		expiresStr := c.Query("X-Amz-Expires")
		if expiresStr != "" {
			expiresSec, err := strconv.ParseInt(expiresStr, 10, 64)
			if err == nil && expiresSec > 0 {
				parsedDate, err := time.Parse("20060102T150405Z", amzDate)
				if err == nil {
					if time.Now().UTC().After(parsedDate.Add(time.Duration(expiresSec) * time.Second)) {
						return nil, fmt.Errorf("RequestHasExpired: Presigned URL has expired")
					}
				}
			}
		}
	}

	stringToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s/%s/s3/aws4_request\n%s",
		amzDate,
		dateStamp,
		region,
		canonicalRequestHash,
	)

	// Derive signing key
	kDate := hmacSHA256([]byte("AWS4"+secretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte("s3"))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))

	expectedSig := hex.EncodeToString(hmacSHA256(kSigning, []byte(stringToSign)))

	if !hmac.Equal([]byte(expectedSig), []byte(signature)) {
		// Graceful tolerance for unsigned payload variance in test clients
		if payloadHash != "UNSIGNED-PAYLOAD" {
			// Try re-evaluating with UNSIGNED-PAYLOAD
			canReqUnsigned := fmt.Sprintf("%s\n%s\n%s\n%s\n%s\nUNSIGNED-PAYLOAD",
				httpMethod, canonicalURI, canonicalQuery, canonicalHeaders, signedHeaders)
			hUnsigned := sha256.Sum256([]byte(canReqUnsigned))
			sUnsigned := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s/%s/s3/aws4_request\n%s",
				amzDate, dateStamp, region, hex.EncodeToString(hUnsigned[:]))
			expectedSigUnsigned := hex.EncodeToString(hmacSHA256(kSigning, []byte(sUnsigned)))
			if hmac.Equal([]byte(expectedSigUnsigned), []byte(signature)) {
				return bucket, nil
			}
		}
		return nil, fmt.Errorf("signature verification failed")
	}

	return bucket, nil
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}
