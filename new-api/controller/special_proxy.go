package controller

import (
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// ProxyKaponSpeech forwards /minimaxi/v1/* to the unified `kapon` channel
// (models.kapon.cloud). Path kept as-is for minimax speech SDK compatibility.
// The lookup is type-agnostic (getChannelByName matches name+status only), so the
// same kapon channel that serves Vidu video via the relay adaptor also backs TTS
// here. Falls back to the legacy `kapon-speech` name for pre-merge deployments.
func ProxyKaponSpeech(c *gin.Context) {
	ch, err := getChannelByName("kapon")
	if err != nil {
		ch, err = getChannelByName("kapon-speech")
	}
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no kapon channel: " + err.Error()})
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

// ProxyYouchuan forwards /youchuan/*path to the youchuan channel
// (ali.youchuan.cn). Youchuan authenticates with non-standard headers
// x-youchuan-app / x-youchuan-secret instead of Bearer, so it needs a
// dedicated handler rather than the generic /proxy/:name route (which forces
// Bearer auth). The channel key stores both credentials as "appId|secret".
//
// Used by the backend Midjourney provider's youchuan mode (V7 / Niji 7), which
// keeps its own request translation / OSS upload / task polling and simply
// points YOUCHUAN_API_BASE_URL at this route so the upstream credentials live
// in the new-api channel panel instead of the backend .env.
func ProxyYouchuan(c *gin.Context) {
	ch, err := getChannelByName("youchuan")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no youchuan channel: " + err.Error()})
		return
	}
	subpath := c.Param("path")
	upstream := ch.GetBaseURL() + subpath
	if q := c.Request.URL.RawQuery; q != "" {
		upstream += "?" + q
	}
	proxyYouchuanRequest(c, ch, upstream)
}

// proxyYouchuanRequest injects Youchuan's x-youchuan-app / x-youchuan-secret
// headers (parsed from channel.Key as "appId|secret") and forwards the request
// body unchanged. The incoming Content-Type is preserved.
func proxyYouchuanRequest(c *gin.Context, ch *model.Channel, upstreamURL string) {
	appID, secret, ok := parseYouchuanKey(ch.Key)
	if !ok {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "youchuan channel key must be \"appId|secret\""})
		return
	}

	req, err := http.NewRequest(c.Request.Method, upstreamURL, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("x-youchuan-app", appID)
	req.Header.Set("x-youchuan-secret", secret)
	if ct := c.Request.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	} else {
		req.Header.Set("Content-Type", "application/json")
	}
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

// parseYouchuanKey splits a "appId|secret" channel key into its two parts.
func parseYouchuanKey(key string) (appID, secret string, ok bool) {
	parts := strings.SplitN(strings.TrimSpace(key), "|", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	appID = strings.TrimSpace(parts[0])
	secret = strings.TrimSpace(parts[1])
	if appID == "" || secret == "" {
		return "", "", false
	}
	return appID, secret, true
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
