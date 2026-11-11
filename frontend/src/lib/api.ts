export interface ProjectData {
  id: string;
  name: string;
  project: string;
  db_name: string;
  admin_role: string;
  readonly_role: string;
  admin_password?: string;
  readonly_password?: string;
  status: string;
  size: string;
  conns: string;
  owner: string;
  extensions?: string[];
  created: string;
  admin_uri?: string;
  readonly_uri?: string;
  admin_pooler_uri?: string;
  readonly_pooler_uri?: string;
}

export interface ColumnSchema {
  name: string;
  type: string;
  is_nullable: boolean;
  flag: string;
  color?: string;
}

export interface TableSchema {
  name: string;
  rows: string;
  cols: ColumnSchema[];
}

export interface SchemaResponse {
  database: string;
  schema: string;
  tables: TableSchema[];
}

export interface RoleData {
  name: string;
  kind: string;
  db: string;
  grants: string;
  rotated: string;
  uri?: string;
  secret?: string;
  border?: string;
  bg?: string;
  fg?: string;
  copyLabel?: string;
}

export interface RotateRoleResponse {
  db_name: string;
  rotated_roles: string[];
  admin_password?: string;
  readonly_password?: string;
  admin_connection_string?: string;
  readonly_connection_string?: string;
  admin_pooler_connection_string?: string;
  readonly_pooler_connection_string?: string;
  terminated_sessions: number;
  rotated_at: string;
}

export interface RotateAllResponse {
  message: string;
  databases_rotated: number;
  redis_rotated: number;
  buckets_rotated: number;
  ai_keys_rotated: number;
  terminated_sessions: number;
  rotated_resources: string[];
}

export interface ActivityData {
  id: number;
  action: string;
  target: string;
  via: string;
  color: string;
  time: string;
}

export interface NodeMetricsData {
  node_host: string;
  postgres_version: string;
  total_databases: string;
  total_connections: string;
  total_disk: string;
  p99_latency: string;
  meters: Array<{ label: string; value: string; pct: string; color: string; detail: string }>;
  config: Record<string, string>;
  control_plane: Record<string, string>;
}

export interface LogEntry {
  time: string;
  level: string;
  msg: string;
  color: string;
}

export interface RedisInstanceData {
  id: string;
  name: string;
  username: string;
  password?: string;
  key_prefix: string;
  status: string;
  key_count: number;
  memory_usage: string;
  uri: string;
  tls_uri?: string;
  cli_command: string;
  host?: string;
  port?: number;
  created_at: string;
  created: string;
}

export interface RedisKeyItemData {
  key: string;
  clean_key: string;
  type: string;
  ttl: number;
  value?: any;
  size?: number;
}

export interface RedisMetricsData {
  redis_version: string;
  used_memory: string;
  used_memory_peak: string;
  max_memory: string;
  connected_clients: number;
  total_keys: number;
  ops_per_sec: number;
  hit_rate_pct: number;
  uptime_days: number;
  status: string;
}

export interface AIKeyData {
  id: string;
  name: string;
  key_prefix: string;
  raw_key?: string;
  tenant_id: string;
  allowed_tools: string[];
  allowed_services: string[];
  is_active: boolean;
  rate_limit_rpm: number;
  total_requests: number;
  last_used_at?: string;
  created_at: string;
}

export interface ImageGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

export interface AIWorkerStatusData {
  online: boolean;
  url?: string;
  model?: string;
  api_key_masked?: string;
  timestamp?: number;
  ttl?: number;
  last_seen_seconds?: number;
}

export interface BackupItemData {
  filename: string;
  scope: string;
  size_bytes: number;
  size_formatted: string;
  created_at: string;
  created_at_display: string;
  age_days: number;
  expires_in_days: number;
  trigger: string;
  status: string;
  remote_status: string;
  notes?: string;
}

export interface S3ConfigInfoData {
  enabled: boolean;
  endpoint: string;
  bucket: string;
  region: string;
  access_key_masked: string;
  status: string;
}

export interface BackupConfigData {
  backup_dir: string;
  retention_days: number;
  schedule_hour: number;
  schedule_display: string;
  total_backups: number;
  total_size_bytes: number;
  total_size_formatted: string;
  s3_config: S3ConfigInfoData;
}

export interface StorageBucketData {
  id: string;
  name: string;
  project_group: string;
  access_key: string;
  secret_key?: string;
  is_public: boolean;
  status: string;
  size_bytes: number;
  size_formatted: string;
  object_count: number;
  endpoint: string;
  s3_uri: string;
  public_url_base: string;
  env_snippet: string;
  created_at: string;
  created: string;
}

export interface StorageObjectData {
  id: string;
  bucket_name: string;
  key: string;
  size_bytes: number;
  size_formatted: string;
  content_type: string;
  etag: string;
  is_public: boolean;
  public_url: string;
  created_at: string;
  created: string;
}

export interface ListObjectsResponse {
  bucket: string;
  prefix: string;
  objects: StorageObjectData[];
  common_prefixes?: string[];
  total_count: number;
  total_bytes: number;
}

export interface PresignResponse {
  url: string;
  bucket: string;
  key: string;
  method: string;
  expires_in_seconds: number;
  expires_at: string;
}

export interface StorageMetricsData {
  total_buckets: number;
  total_objects: number;
  total_size_bytes: number;
  total_size_formatted: string;
  storage_dir: string;
  public_base_url: string;
}

export interface CreateBucketResponse {
  bucket: StorageBucketData;
  endpoint: string;
  access_key_id: string;
  secret_access_key: string;
  public_url: string;
  env_snippet: string;
}

export interface GroupedProjectData {
  id?: string;
  name: string;
  description?: string;
  color?: string;
  databases: ProjectData[];
  redis: RedisInstanceData[];
  buckets: StorageBucketData[];
  ai_keys: AIKeyData[];
  total_resources: number;
}

export interface GroupedResourcesResponse {
  projects: GroupedProjectData[];
  total_projects: number;
  total_resources: number;
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('vpsql_api_endpoint');
    if (custom && custom.trim() !== '') {
      return custom.trim().replace(/\/+$/, '');
    }
    // In browser, route through the Next.js same-origin App Router proxy
    return '/api/vpsql';
  }
  return process.env.API_URL || 'http://api:8080';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${cleanPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };

  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('vpsql_token');
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
    cache: 'no-store',
  });

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errorDetail = errJson.error || errJson.detail || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text();
    }
    throw new Error(errorDetail || `API error (${res.status})`);
  }

  return res.json();
}

export const api = {
  checkHealth: () => request<{ status: string; postgres: string; uptime: string }>('/health'),

  getAuthMe: () => request<{ authenticated: boolean; email: string; token?: string }>('/v1/auth/me'),

  login: (email: string, password: string, endpoint?: string) =>
    request<{ token: string; email: string }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, endpoint }),
    }),

  listProjects: () => request<ProjectData[]>('/v1/projects'),

  getProject: (id: string) => request<ProjectData>(`/v1/projects/${id}`),

  createProject: (name: string, project: string, extensions: string[]) =>
    request<{
      project: ProjectData;
      admin_connection_string: string;
      readonly_connection_string: string;
      admin_pooler_connection_string: string;
      readonly_pooler_connection_string: string;
    }>('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name, project, extensions }),
    }),

  deleteProject: (id: string) =>
    request<{ status: string; id: string }>(`/v1/projects/${id}`, {
      method: 'DELETE',
    }),

  branchProject: (id: string, name: string) =>
    request<{
      project: ProjectData;
      admin_connection_string: string;
      readonly_connection_string: string;
      admin_pooler_connection_string: string;
      readonly_pooler_connection_string: string;
    }>(`/v1/projects/${id}/branch`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getSchema: (id: string) => request<SchemaResponse>(`/v1/projects/${id}/schema`),

  executeQuery: (id: string, query: string) =>
    request<{
      columns: string[];
      rows: Record<string, any>[];
      row_count: number;
      duration_ms: number;
    }>(`/v1/projects/${id}/query`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),

  listRoles: () => request<RoleData[]>('/v1/roles'),

  listActivity: () => request<ActivityData[]>('/v1/activity'),

  getNodeMetrics: () => request<NodeMetricsData>('/v1/node/metrics'),

  getProjectLogs: (id: string) => request<LogEntry[]>(`/v1/projects/${id}/logs`),

  // Redis endpoints
  listRedis: () => request<RedisInstanceData[]>('/v1/redis'),

  getRedis: (id: string) => request<RedisInstanceData>(`/v1/redis/${id}`),

  createRedis: (name: string, project_group?: string) =>
    request<{
      instance: RedisInstanceData;
      connection_string: string;
      cli_command: string;
    }>('/v1/redis', {
      method: 'POST',
      body: JSON.stringify({ name, project_group }),
    }),

  deleteRedis: (id: string) =>
    request<{ status: string; id: string }>(`/v1/redis/${id}`, {
      method: 'DELETE',
    }),

  listRedisKeys: (id: string, pattern?: string) =>
    request<RedisKeyItemData[]>(`/v1/redis/${id}/keys${pattern ? `?pattern=${encodeURIComponent(pattern)}` : ''}`),

  getRedisKey: (id: string, key: string) =>
    request<RedisKeyItemData>(`/v1/redis/${id}/key?key=${encodeURIComponent(key)}`),

  setRedisKey: (id: string, key: string, value: string, ttl?: number) =>
    request<{ status: string; key: string }>(`/v1/redis/${id}/keys`, {
      method: 'POST',
      body: JSON.stringify({ key, value, ttl }),
    }),

  deleteRedisKey: (id: string, key: string) =>
    request<{ status: string; key: string }>(`/v1/redis/${id}/keys/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),

  flushRedisKeys: (id: string) =>
    request<{ status: string; deleted_keys: number }>(`/v1/redis/${id}/flush`, {
      method: 'POST',
    }),

  getRedisMetrics: () => request<RedisMetricsData>('/v1/redis/metrics'),

  // AI Gateway endpoints
  getAIWorkerStatus: () => request<AIWorkerStatusData>('/v1/ai/status'),

  listAIKeys: () => request<AIKeyData[]>('/v1/ai/keys'),

  createAIKey: (name: string, tenant_id?: string, allowed_tools?: string[], allowed_services?: string[], rate_limit_rpm?: number, project_group?: string) =>
    request<AIKeyData>('/v1/ai/keys', {
      method: 'POST',
      body: JSON.stringify({ name, tenant_id, allowed_tools, allowed_services, rate_limit_rpm, project_group }),
    }),

  updateAIKey: (id: string, data: { name?: string; tenant_id?: string; allowed_tools?: string[]; allowed_services?: string[]; rate_limit_rpm?: number; is_active?: boolean }) =>
    request<AIKeyData>(`/v1/ai/keys/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  toggleAIKeyStatus: (id: string) =>
    request<AIKeyData>(`/v1/ai/keys/${id}/toggle`, {
      method: 'PATCH',
    }),

  deleteAIKey: (id: string) =>
    request<{ status: string; id: string }>(`/v1/ai/keys/${id}`, {
      method: 'DELETE',
    }),

  generateAIImage: (prompt: string, model?: string, apiKey?: string) =>
    request<ImageGenerationResponse>('/v1/ai/images/generations', {
      method: 'POST',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      body: JSON.stringify({ prompt, model }),
    }),

  // Backups & Snapshots endpoints (7d retention + S3/R2 plug&play)
  listBackups: () => request<BackupItemData[]>('/v1/backups'),

  getBackupConfig: () => request<BackupConfigData>('/v1/backups/config'),

  createBackup: (scope?: string, notes?: string) =>
    request<BackupItemData>('/v1/backups', {
      method: 'POST',
      body: JSON.stringify({ scope: scope || 'all', notes }),
    }),

  deleteBackup: (filename: string) =>
    request<{ success: boolean; message: string }>(`/v1/backups/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),

  getBackupDownloadUrl: (filename: string) => {
    const base = getApiBaseUrl();
    const token = typeof window !== 'undefined' ? localStorage.getItem('vpsql_token') || '' : '';
    return `${base}/v1/backups/${encodeURIComponent(filename)}/download?token=${encodeURIComponent(token)}`;
  },

  // S3 Storage (Static Buckets & Objects)
  listBuckets: (project?: string) =>
    request<StorageBucketData[]>(project ? `/v1/storage/buckets?project=${encodeURIComponent(project)}` : '/v1/storage/buckets'),

  getBucket: (id: string) => request<StorageBucketData>(`/v1/storage/buckets/${id}`),

  createBucket: (name: string, project_group?: string, is_public?: boolean) =>
    request<CreateBucketResponse>('/v1/storage/buckets', {
      method: 'POST',
      body: JSON.stringify({ name, project_group, is_public }),
    }),

  updateBucket: (id: string, data: { project_group?: string; is_public?: boolean }) =>
    request<StorageBucketData>(`/v1/storage/buckets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteBucket: (id: string) =>
    request<{ status: string; id: string }>(`/v1/storage/buckets/${id}`, {
      method: 'DELETE',
    }),

  listBucketObjects: (id: string, prefix?: string) =>
    request<ListObjectsResponse>(prefix ? `/v1/storage/buckets/${id}/objects?prefix=${encodeURIComponent(prefix)}` : `/v1/storage/buckets/${id}/objects`),

  uploadBucketObject: async (id: string, file: File, key?: string): Promise<StorageObjectData> => {
    const base = getApiBaseUrl();
    const token = typeof window !== 'undefined' ? localStorage.getItem('vpsql_token') : null;
    const formData = new FormData();
    formData.append('file', file);
    if (key) {
      formData.append('key', key);
    }
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${base}/v1/storage/buckets/${id}/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Upload failed with status ${res.status}`);
    }
    return res.json();
  },

  deleteBucketObject: (id: string, key: string) =>
    request<{ status: string; key: string }>(`/v1/storage/buckets/${id}/objects/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),

  presignBucketObject: (id: string, key: string, method = 'GET', expiresInSeconds = 3600) =>
    request<PresignResponse>(`/v1/storage/buckets/${id}/presign`, {
      method: 'POST',
      body: JSON.stringify({ key, method, expires_in_seconds: expiresInSeconds }),
    }),

  getStorageMetrics: () => request<StorageMetricsData>('/v1/storage/metrics'),

  // Grouped Projects & Project Management
  getGroupedProjects: async (): Promise<GroupedResourcesResponse> => {
    try {
      return await request<GroupedResourcesResponse>('/v1/projects/grouped');
    } catch {
      return await request<GroupedResourcesResponse>('/v1/workspaces');
    }
  },
  createProjectGroup: async (name: string, description?: string, color?: string) => {
    try {
      return await request<{ id: string; name: string; description?: string; color?: string; status: string }>('/v1/projects/groups', {
        method: 'POST',
        body: JSON.stringify({ name, description, color }),
      });
    } catch {
      return await request<{ id: string; name: string; description?: string; color?: string; status: string }>('/v1/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name, description, color }),
      });
    }
  },
  deleteProjectGroup: (name: string) =>
    request<{ status: string; name: string }>(`/v1/projects/groups/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  attachResourceToProject: (projectName: string, resourceType: string, resourceId: string) =>
    request<{ status: string; project: string; resource_type: string; resource_id: string }>(`/v1/projects/groups/${encodeURIComponent(projectName)}/attach`, {
      method: 'POST',
      body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
    }),
  detachResourceFromProject: (projectName: string, resourceType: string, resourceId: string) =>
    request<{ status: string; project: string; resource_type: string; resource_id: string }>(`/v1/projects/groups/${encodeURIComponent(projectName)}/detach`, {
      method: 'POST',
      body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
    }),

  // Rotation methods (Granular & Bulk)
  rotateRole: (roleName: string, terminateConnections = true) =>
    request<RotateRoleResponse>(`/v1/roles/${encodeURIComponent(roleName)}/rotate`, {
      method: 'POST',
      body: JSON.stringify({ terminate_connections: terminateConnections }),
    }),

  rotateProject: (id: string, role = 'all', terminateConnections = true) =>
    request<RotateRoleResponse>(`/v1/projects/${encodeURIComponent(id)}/rotate`, {
      method: 'POST',
      body: JSON.stringify({ role, terminate_connections: terminateConnections }),
    }),

  rotateRedis: (id: string) =>
    request<{ instance: RedisInstanceData; connection_string: string; cli_command: string }>(`/v1/redis/${encodeURIComponent(id)}/rotate`, {
      method: 'POST',
    }),

  rotateBucket: (id: string) =>
    request<CreateBucketResponse>(`/v1/storage/buckets/${encodeURIComponent(id)}/rotate`, {
      method: 'POST',
    }),

  rotateAIKey: (id: string) =>
    request<AIKeyData>(`/v1/ai/keys/${encodeURIComponent(id)}/rotate`, {
      method: 'POST',
    }),

  rotateAll: (scope = 'all', terminateConnections = true) =>
    request<RotateAllResponse>('/v1/rotate/all', {
      method: 'POST',
      body: JSON.stringify({ scope, terminate_connections: terminateConnections }),
    }),
};

