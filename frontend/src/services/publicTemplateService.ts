import type { FlowTemplate, TemplateIndexEntry } from "@/types/template";

export interface PublicTemplate extends TemplateIndexEntry {
  templateData?: FlowTemplate;
  isActive?: boolean;
  sortOrder?: number;
  thumbnailSmall?: string;
  updatedAt?: string;
}

const API_BASE =
  import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

// 简单的授权头构造器：若需自定义认证（例如 Bearer token），在此扩展
export function buildAuthHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  // 如果将来需要在头中加入 Authorization 或其它认证字段，
  // 可以在这里读取 cookie/localStorage 或调用认证服务来获取 token 并设置：
  // const token = getAuthToken();
  // if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// 获取公共模板索引
export async function fetchPublicTemplateIndex(): Promise<
  TemplateIndexEntry[]
> {
  try {
    const response = await fetch(`${API_BASE}/api/templates/index`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("fetchPublicTemplateIndex error:", error);
    return [];
  }
}

// 根据ID获取公共模板数据
export async function fetchPublicTemplateById(
  id: string
): Promise<FlowTemplate | null> {
  try {
    const response = await fetch(`${API_BASE}/api/templates/${id}`);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data as FlowTemplate;
  } catch (error) {
    console.warn("fetchPublicTemplateById error:", error);
    return null;
  }
}

export interface CreateTemplateRequest {
  name: string;
  category?: string;
  description?: string;
  tags?: string[];
  thumbnail?: string;
  thumbnailSmall?: string;
  templateData?: any;
  templateJsonKey?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateTemplateRequest {
  name?: string;
  category?: string;
  description?: string;
  tags?: string[];
  thumbnail?: string;
  thumbnailSmall?: string;
  templateData?: any;
  isActive?: boolean;
  sortOrder?: number;
}

export interface TemplateQueryParams {
  page?: number;
  pageSize?: number;
  category?: string;
  isActive?: boolean;
  search?: string;
}

export interface TemplateListResponse {
  items: PublicTemplate[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// 创建模板
export async function createTemplate(
  data: CreateTemplateRequest
): Promise<PublicTemplate> {
  const headers = buildAuthHeaders("application/json");
  const response = await fetch(`${API_BASE}/api/admin/templates`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to create template: ${response.statusText}`);
  }

  return response.json();
}

// 获取模板列表
export async function fetchTemplates(
  params: TemplateQueryParams = {}
): Promise<TemplateListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", params.page.toString());
  if (params.pageSize) searchParams.set("pageSize", params.pageSize.toString());
  if (params.category) searchParams.set("category", params.category);
  if (params.isActive !== undefined)
    searchParams.set("isActive", params.isActive.toString());
  if (params.search) searchParams.set("search", params.search);

  const headers = buildAuthHeaders();
  const response = await fetch(
    `${API_BASE}/api/admin/templates?${searchParams}`,
    {
      credentials: "include",
      headers,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch templates: ${response.statusText}`);
  }

  return response.json();
}

// 获取单个模板
export async function fetchTemplate(id: string): Promise<PublicTemplate> {
  const headers = buildAuthHeaders();
  const response = await fetch(`${API_BASE}/api/admin/templates/${id}`, {
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch template: ${response.statusText}`);
  }

  return response.json();
}

// 更新模板
export async function updateTemplate(
  id: string,
  data: UpdateTemplateRequest
): Promise<PublicTemplate> {
  const headers = buildAuthHeaders("application/json");
  const response = await fetch(`${API_BASE}/api/admin/templates/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to update template: ${response.statusText}`);
  }

  return response.json();
}

// 删除模板
export async function deleteTemplate(id: string): Promise<void> {
  const headers = buildAuthHeaders();
  const response = await fetch(`${API_BASE}/api/admin/templates/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to delete template: ${response.statusText}`);
  }
}

// 获取模板分类
export async function fetchTemplateCategories(): Promise<string[]> {
  const headers = buildAuthHeaders();
  const response = await fetch(`${API_BASE}/api/templates/categories`, {
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch categories: ${response.statusText}`);
  }

  return response.json();
}
