package controller

import (
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// ProxyKaponSpeech forwards all /minimaxi/v1/* requests to the kapon-speech channel
// (models.kapon.cloud), preserving the full path and query string.
func ProxyKaponSpeech(c *gin.Context) {
	ch, err := getChannelByName("kapon-speech")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no kapon-speech channel: " + err.Error()})
		return
	}
	subpath := c.Param("path") // e.g. "/t2a_v2"
	upstream := ch.GetBaseURL() + "/minimaxi/v1" + subpath
	if q := c.Request.URL.RawQuery; q != "" {
		upstream += "?" + q
	}
	proxySpecialRequest(c, ch, upstream)
}

// ProxyMinimaxMusic forwards POST /v1/music_generation to the minimax-music channel
// (api.minimaxi.com).
func ProxyMinimaxMusic(c *gin.Context) {
	ch, err := getChannelByName("minimax-music")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no minimax-music channel: " + err.Error()})
		return
	}
	proxySpecialRequest(c, ch, ch.GetBaseURL()+"/v1/music_generation")
}

// ProxyRemoveBg forwards requests to the remove.bg API.
// remove.bg uses X-Api-Key (not Bearer) and multipart/form-data uploads,
// so Content-Type is preserved from the incoming request rather than forced to JSON.
func ProxyRemoveBg(c *gin.Context) {
	ch, err := getChannelByName("remove-bg")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no remove-bg channel: " + err.Error()})
		return
	}
	subpath := c.Param("path")
	upstream := ch.GetBaseURL() + subpath
	if q := c.Request.URL.RawQuery; q != "" {
		upstream += "?" + q
	}

	req, err := http.NewRequest(c.Request.Method, upstream, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("X-Api-Key", ch.Key)
	if ct := c.Request.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}

	httpClient, err := service.GetHttpClientWithProxy(ch.GetSetting().Proxy)
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

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/png"
	}
	c.Status(resp.StatusCode)
	c.Header("Content-Type", contentType)
	_, _ = io.Copy(c.Writer, resp.Body)
}

// ProxyWatcha forwards all /proxy/watcha/* requests to the watcha-seedream channel
// (tokendance.agent-universe.cn/gateway/ark), used by Seedream5 Watcha provider.
func ProxyWatcha(c *gin.Context) {
	ch, err := getChannelByName("watcha-seedream")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no watcha-seedream channel: " + err.Error()})
		return
	}
	subpath := c.Param("path")
	upstream := ch.GetBaseURL() + subpath
	if q := c.Request.URL.RawQuery; q != "" {
		upstream += "?" + q
	}
	proxySpecialRequest(c, ch, upstream)
}

// ProxyArk forwards all /proxy/ark/* requests to the ark channel
// (ark.cn-beijing.volces.com/api/v3), appending the captured path.
// Shared by Seed3D and Seedream5 — both use the same ARK base URL and API key.
func ProxyArk(c *gin.Context) {
	ch, err := getChannelByName("ark")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no ark channel: " + err.Error()})
		return
	}
	subpath := c.Param("path") // e.g. "/contents/generations/tasks"
	upstream := ch.GetBaseURL() + subpath
	if q := c.Request.URL.RawQuery; q != "" {
		upstream += "?" + q
	}
	proxySpecialRequest(c, ch, upstream)
}

// getChannelByName returns the first active channel with the given name.
func getChannelByName(name string) (*model.Channel, error) {
	var ch model.Channel
	err := model.DB.
		Where("name = ? AND status = 1", name).
		First(&ch).Error
	return &ch, err
}

// proxySpecialRequest forwards the request to upstreamURL using the channel's API key.
// It preserves the request method, body, and forwards the upstream Content-Type verbatim.
func proxySpecialRequest(c *gin.Context, ch *model.Channel, upstreamURL string) {
	req, err := http.NewRequest(c.Request.Method, upstreamURL, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("Authorization", "Bearer "+ch.Key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	httpClient, err := service.GetHttpClientWithProxy(ch.GetSetting().Proxy)
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

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	c.Status(resp.StatusCode)
	c.Header("Content-Type", contentType)
	_, _ = io.Copy(c.Writer, resp.Body)
}
