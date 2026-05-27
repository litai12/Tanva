package controller

import (
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// ProxyKaponSpeech forwards /minimaxi/v1/* to the kapon-speech channel
// (models.kapon.cloud). Path kept as-is for minimax speech SDK compatibility.
func ProxyKaponSpeech(c *gin.Context) {
	ch, err := getChannelByName("kapon-speech")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no kapon-speech channel: " + err.Error()})
		return
	}
	subpath := c.Param("path")
	upstream := ch.GetBaseURL() + "/minimaxi/v1" + subpath
	if q := c.Request.URL.RawQuery; q != "" {
		upstream += "?" + q
	}
	proxySpecialRequest(c, ch, upstream)
}

// ProxyMinimaxMusic forwards POST /v1/music_generation to the minimax-music channel.
func ProxyMinimaxMusic(c *gin.Context) {
	ch, err := getChannelByName("minimax-music")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no minimax-music channel: " + err.Error()})
		return
	}
	proxySpecialRequest(c, ch, ch.GetBaseURL()+"/v1/music_generation")
}

// GenericChannelProxy handles /proxy/:name/*path.
// It looks up the channel by the :name segment, then proxies the request to
// channel.base_url + path, forwarding the query string.
//
// Special cases:
//   - "remove-bg": uses X-Api-Key auth and preserves the incoming Content-Type
//     (multipart/form-data) instead of forcing application/json.
//   - all others: Bearer auth, Content-Type: application/json.
func GenericChannelProxy(c *gin.Context) {
	name := c.Param("name")
	ch, err := getChannelByName(name)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no channel '" + name + "': " + err.Error()})
		return
	}

	subpath := c.Param("path")
	upstream := ch.GetBaseURL() + subpath
	if q := c.Request.URL.RawQuery; q != "" {
		upstream += "?" + q
	}

	if strings.EqualFold(name, "remove-bg") {
		proxyRemoveBg(c, ch, upstream)
		return
	}
	proxySpecialRequest(c, ch, upstream)
}

// proxyRemoveBg uses X-Api-Key auth and preserves the incoming Content-Type.
// remove.bg accepts multipart/form-data and returns binary PNG.
func proxyRemoveBg(c *gin.Context, ch *model.Channel, upstreamURL string) {
	req, err := http.NewRequest(c.Request.Method, upstreamURL, c.Request.Body)
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

// getChannelByName returns the first active channel with the given name.
func getChannelByName(name string) (*model.Channel, error) {
	var ch model.Channel
	err := model.DB.
		Where("name = ? AND status = 1", name).
		First(&ch).Error
	return &ch, err
}

// proxySpecialRequest forwards the request using Bearer auth and JSON content type.
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
