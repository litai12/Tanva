package controller

import (
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// ProxyApimartCharacterCreate handles POST /v1/characters_tasks
// Forwards to APIMart POST /v1/videos/generations (character task submission).
func ProxyApimartCharacterCreate(c *gin.Context) {
	ch, err := getFirstApimartChannel()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no apimart channel available: " + err.Error()})
		return
	}
	proxyToUpstream(c, ch, ch.GetBaseURL()+"/v1/videos/generations")
}

// ProxyApimartCharacterFetch handles GET /v1/characters_tasks/:task_id
// Forwards to APIMart GET /v1/characters_tasks/:task_id.
func ProxyApimartCharacterFetch(c *gin.Context) {
	ch, err := getFirstApimartChannel()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no apimart channel available: " + err.Error()})
		return
	}
	taskID := c.Param("task_id")
	proxyToUpstream(c, ch, ch.GetBaseURL()+"/v1/characters_tasks/"+taskID)
}

// getFirstApimartChannel returns the highest-priority enabled APIMart channel with its key.
func getFirstApimartChannel() (*model.Channel, error) {
	var ch model.Channel
	err := model.DB.
		Where("type = ? AND status = 1", constant.ChannelTypeApimart).
		Order("priority DESC, weight DESC").
		First(&ch).Error
	if err != nil {
		return nil, err
	}
	return &ch, nil
}

// proxyToUpstream forwards the incoming request to upstreamURL using the channel's credentials.
func proxyToUpstream(c *gin.Context, ch *model.Channel, upstreamURL string) {
	req, err := http.NewRequest(c.Request.Method, upstreamURL, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("Authorization", "Bearer "+ch.Key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	proxy := ch.GetSetting().Proxy
	httpClient, err := service.GetHttpClientWithProxy(proxy)
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

	c.Status(resp.StatusCode)
	c.Header("Content-Type", "application/json")
	_, _ = io.Copy(c.Writer, resp.Body)
}
