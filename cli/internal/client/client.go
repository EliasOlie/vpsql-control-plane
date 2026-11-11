package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type APIClient struct {
	BaseURL    string
	Token      string
	httpClient *http.Client
}

func New(baseURL, token string) *APIClient {
	cleanURL := strings.TrimRight(baseURL, "/")
	return &APIClient{
		BaseURL: cleanURL,
		Token:   token,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *APIClient) doRequest(method, path string, body any, target any) error {
	url := fmt.Sprintf("%s%s", c.BaseURL, path)
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to encode request body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var errMap map[string]any
		if jsonErr := json.Unmarshal(respBytes, &errMap); jsonErr == nil && errMap["error"] != nil {
			return fmt.Errorf("API error (%d): %v", resp.StatusCode, errMap["error"])
		}
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBytes))
	}

	if target != nil {
		if err := json.Unmarshal(respBytes, target); err != nil {
			return fmt.Errorf("failed to decode JSON response: %w", err)
		}
	}

	return nil
}

func (c *APIClient) Health() (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("GET", "/health", nil, &result)
	return result, err
}

func (c *APIClient) Login(email, password string) (map[string]any, error) {
	body := map[string]string{
		"email":    email,
		"password": password,
		"endpoint": c.BaseURL,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/auth/login", body, &result)
	return result, err
}

func (c *APIClient) CreateProject(name, project string, extensions []string) (map[string]any, error) {
	body := map[string]any{
		"name":       name,
		"project":    project,
		"extensions": extensions,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/projects", body, &result)
	return result, err
}

func (c *APIClient) ListProjects() ([]map[string]any, error) {
	var result []map[string]any
	err := c.doRequest("GET", "/v1/projects", nil, &result)
	return result, err
}

func (c *APIClient) GetProject(id string) (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("GET", "/v1/projects/"+id, nil, &result)
	return result, err
}

func (c *APIClient) DeleteProject(id string) error {
	return c.doRequest("DELETE", "/v1/projects/"+id, nil, nil)
}

func (c *APIClient) GetSchema(id string) (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("GET", "/v1/projects/"+id+"/schema", nil, &result)
	return result, err
}

func (c *APIClient) ExecuteQuery(id, sqlQuery string) (map[string]any, error) {
	body := map[string]string{
		"query": sqlQuery,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/projects/"+id+"/query", body, &result)
	return result, err
}

func (c *APIClient) ListRoles() ([]map[string]any, error) {
	var result []map[string]any
	err := c.doRequest("GET", "/v1/roles", nil, &result)
	return result, err
}

func (c *APIClient) GetNodeMetrics() (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("GET", "/v1/node/metrics", nil, &result)
	return result, err
}

func (c *APIClient) BranchProject(id, name string) (map[string]any, error) {
	body := map[string]string{
		"name": name,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/projects/"+id+"/branch", body, &result)
	return result, err
}

func (c *APIClient) ListRedis() ([]map[string]any, error) {
	var result []map[string]any
	err := c.doRequest("GET", "/v1/redis", nil, &result)
	return result, err
}

func (c *APIClient) GetRedis(id string) (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("GET", "/v1/redis/"+id, nil, &result)
	return result, err
}

func (c *APIClient) CreateRedis(name string) (map[string]any, error) {
	body := map[string]string{
		"name": name,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/redis", body, &result)
	return result, err
}

func (c *APIClient) DeleteRedis(id string) error {
	return c.doRequest("DELETE", "/v1/redis/"+id, nil, nil)
}

func (c *APIClient) ListRedisKeys(id, pattern string) ([]map[string]any, error) {
	var result []map[string]any
	path := "/v1/redis/" + id + "/keys"
	if pattern != "" {
		path += "?pattern=" + pattern
	}
	err := c.doRequest("GET", path, nil, &result)
	return result, err
}

func (c *APIClient) SetRedisKey(id, key, value string, ttl int) error {
	body := map[string]any{
		"key":   key,
		"value": value,
		"ttl":   ttl,
	}
	return c.doRequest("POST", "/v1/redis/"+id+"/keys", body, nil)
}

func (c *APIClient) DeleteRedisKey(id, key string) error {
	return c.doRequest("DELETE", "/v1/redis/"+id+"/keys/"+key, nil, nil)
}

func (c *APIClient) FlushRedisKeys(id string) (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("POST", "/v1/redis/"+id+"/flush", nil, &result)
	return result, err
}

func (c *APIClient) GetRedisMetrics() (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("GET", "/v1/redis/metrics", nil, &result)
	return result, err
}

// Storage (S3-Compliant) API methods

func (c *APIClient) ListBuckets(project string) ([]map[string]any, error) {
	path := "/v1/storage/buckets"
	if project != "" {
		path += "?project=" + project
	}
	var result []map[string]any
	err := c.doRequest("GET", path, nil, &result)
	return result, err
}

func (c *APIClient) GetBucket(idOrName string) (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("GET", "/v1/storage/buckets/"+idOrName, nil, &result)
	return result, err
}

func (c *APIClient) CreateBucket(name, project string, isPublic bool) (map[string]any, error) {
	body := map[string]any{
		"name":          name,
		"project_group": project,
		"is_public":     isPublic,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/storage/buckets", body, &result)
	return result, err
}

func (c *APIClient) DeleteBucket(idOrName string) error {
	return c.doRequest("DELETE", "/v1/storage/buckets/"+idOrName, nil, nil)
}

func (c *APIClient) ListBucketObjects(idOrName, prefix string) (map[string]any, error) {
	path := "/v1/storage/buckets/" + idOrName + "/objects"
	if prefix != "" {
		path += "?prefix=" + prefix
	}
	var result map[string]any
	err := c.doRequest("GET", path, nil, &result)
	return result, err
}

func (c *APIClient) UploadBucketObject(bucket, localFilePath, targetKey string) (map[string]any, error) {
	file, err := os.Open(localFilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file %s: %w", localFilePath, err)
	}
	defer file.Close()

	if targetKey == "" {
		targetKey = filepath.Base(localFilePath)
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", filepath.Base(localFilePath))
	if err != nil {
		return nil, fmt.Errorf("failed to create multipart form file: %w", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, fmt.Errorf("failed to copy file payload: %w", err)
	}
	_ = writer.WriteField("key", targetKey)
	_ = writer.Close()

	url := fmt.Sprintf("%s/v1/storage/buckets/%s/upload", c.BaseURL, bucket)
	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upload HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upload failed (%d): %s", resp.StatusCode, string(respBytes))
	}

	var result map[string]any
	_ = json.Unmarshal(respBytes, &result)
	return result, nil
}

func (c *APIClient) PresignBucketObject(bucket, key, method string, expiresInSeconds int64) (map[string]any, error) {
	body := map[string]any{
		"key":                key,
		"method":             method,
		"expires_in_seconds": expiresInSeconds,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/storage/buckets/"+bucket+"/presign", body, &result)
	return result, err
}

func (c *APIClient) GetStorageMetrics() (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("GET", "/v1/storage/metrics", nil, &result)
	return result, err
}

// Grouped Projects API methods

func (c *APIClient) GetGroupedProjects() (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("GET", "/v1/projects/grouped", nil, &result)
	return result, err
}

func (c *APIClient) CreateProjectGroup(name, description, color string) (map[string]any, error) {
	body := map[string]string{
		"name":        name,
		"description": description,
		"color":       color,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/projects/groups", body, &result)
	return result, err
}

func (c *APIClient) DeleteProjectGroup(name string) (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("DELETE", "/v1/projects/groups/"+name, nil, &result)
	return result, err
}

func (c *APIClient) AttachResourceToProject(projectName, resourceType, resourceID string) (map[string]any, error) {
	body := map[string]string{
		"resource_type": resourceType,
		"resource_id":   resourceID,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/projects/groups/"+projectName+"/attach", body, &result)
	return result, err
}

func (c *APIClient) DetachResourceFromProject(projectName, resourceType, resourceID string) (map[string]any, error) {
	body := map[string]string{
		"resource_type": resourceType,
		"resource_id":   resourceID,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/projects/groups/"+projectName+"/detach", body, &result)
	return result, err
}

// Rotation API methods

func (c *APIClient) RotateDatabase(id, role string, terminateConns bool) (map[string]any, error) {
	body := map[string]any{
		"role":                  role,
		"terminate_connections": terminateConns,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/projects/"+id+"/rotate", body, &result)
	return result, err
}

func (c *APIClient) RotateRole(roleName string, terminateConns bool) (map[string]any, error) {
	body := map[string]any{
		"terminate_connections": terminateConns,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/roles/"+roleName+"/rotate", body, &result)
	return result, err
}

func (c *APIClient) RotateRedis(id string) (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("POST", "/v1/redis/"+id+"/rotate", nil, &result)
	return result, err
}

func (c *APIClient) RotateBucket(idOrName string) (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("POST", "/v1/storage/buckets/"+idOrName+"/rotate", nil, &result)
	return result, err
}

func (c *APIClient) RotateAIKey(id string) (map[string]any, error) {
	var result map[string]any
	err := c.doRequest("POST", "/v1/ai/keys/"+id+"/rotate", nil, &result)
	return result, err
}

func (c *APIClient) RotateAll(scope string, terminateConns bool) (map[string]any, error) {
	body := map[string]any{
		"scope":                 scope,
		"terminate_connections": terminateConns,
	}
	var result map[string]any
	err := c.doRequest("POST", "/v1/rotate/all", body, &result)
	return result, err
}

