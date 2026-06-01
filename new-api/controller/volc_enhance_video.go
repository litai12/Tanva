package controller

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func ProxyVolcEnhanceVideoCreate(c *gin.Context) {
	apiKey := strings.TrimSpace(firstNonEmpty(
		os.Getenv("VOLC_MEDIAKIT_API_KEY"),
		os.Getenv("VOLC_ENHANCE_VIDEO_API_KEY"),
		os.Getenv("VOLC_ENHANCE_API_KEY"),
	))
	if apiKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "video enhance service not configured (missing VOLC_MEDIAKIT_API_KEY)",
		})
		return
	}

	baseURL := strings.TrimRight(strings.TrimSpace(firstNonEmpty(
		os.Getenv("VOLC_MEDIAKIT_API_BASE_URL"),
		"https://mediakit.cn-beijing.volces.com",
	)), "/")
	upstreamURL := baseURL + "/api/v1/tools/enhance-video"

	proxyToVolcMediaKit(c, upstreamURL, apiKey)
}

func ProxyVolcEnhanceVideoFetch(c *gin.Context) {
	apiKey := strings.TrimSpace(firstNonEmpty(
		os.Getenv("VOLC_MEDIAKIT_API_KEY"),
		os.Getenv("VOLC_ENHANCE_VIDEO_API_KEY"),
		os.Getenv("VOLC_ENHANCE_API_KEY"),
	))
	if apiKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "video enhance service not configured (missing VOLC_MEDIAKIT_API_KEY)",
		})
		return
	}

	taskID := strings.TrimSpace(c.Param("task_id"))
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task_id is required"})
		return
	}

	baseURL := strings.TrimRight(strings.TrimSpace(firstNonEmpty(
		os.Getenv("VOLC_MEDIAKIT_API_BASE_URL"),
		"https://mediakit.cn-beijing.volces.com",
	)), "/")
	upstreamURL := baseURL + "/api/v1/tasks/" + taskID

	proxyToVolcMediaKit(c, upstreamURL, apiKey)
}

func proxyToVolcMediaKit(c *gin.Context, upstreamURL string, apiKey string) {
	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, upstreamURL, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")
	if contentType := strings.TrimSpace(c.GetHeader("Content-Type")); contentType != "" {
		req.Header.Set("Content-Type", contentType)
	} else {
		req.Header.Set("Content-Type", "application/json")
	}

	httpClient, err := service.GetHttpClientWithProxy("")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	c.Status(resp.StatusCode)
	c.Header("Content-Type", "application/json")
	if len(body) == 0 {
		_, _ = c.Writer.Write([]byte("{}"))
		return
	}
	if json.Valid(body) {
		_, _ = c.Writer.Write(body)
		return
	}

	fallback, _ := json.Marshal(gin.H{"message": string(body)})
	_, _ = c.Writer.Write(fallback)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
