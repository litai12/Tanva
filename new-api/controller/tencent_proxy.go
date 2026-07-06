package controller

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// ProxyTencentMPS signs and forwards requests to mps.tencentcloudapi.com.
// The caller (backend) sends the raw Tencent payload in the body and passes
// X-TC-Action, X-TC-Version, and X-TC-Region as request headers.
// new-api looks up the "tencent-mps" channel, adds TC3-HMAC-SHA256 auth, and forwards.
func ProxyTencentMPS(c *gin.Context) {
	proxyTencent(c, "tencent", "mps.tencentcloudapi.com", "mps")
}

// ProxyTencentVOD signs and forwards requests to vod.tencentcloudapi.com.
func ProxyTencentVOD(c *gin.Context) {
	proxyTencent(c, "tencent", "vod.tencentcloudapi.com", "vod")
}

func proxyTencent(c *gin.Context, channelName, host, svcName string) {
	ch, err := getChannelByName(channelName)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "channel not found: " + err.Error()})
		return
	}

	secretId, secretKey, err := parseTencentKey(ch.Key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body: " + err.Error()})
		return
	}

	action := c.GetHeader("X-TC-Action")
	if action == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "X-TC-Action header is required"})
		return
	}
	version := c.GetHeader("X-TC-Version")
	region := c.GetHeader("X-TC-Region")
	token := c.GetHeader("X-TC-Token")

	timestamp := time.Now().Unix()
	authorization := tc3Sign(secretId, secretKey, host, svcName, action, body, timestamp)

	req, err := http.NewRequest(http.MethodPost, "https://"+host+"/", bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("Authorization", authorization)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Host", host)
	req.Header.Set("X-TC-Action", action)
	req.Header.Set("X-TC-Timestamp", strconv.FormatInt(timestamp, 10))
	if version != "" {
		req.Header.Set("X-TC-Version", version)
	}
	if region != "" {
		req.Header.Set("X-TC-Region", region)
	}
	if token != "" {
		req.Header.Set("X-TC-Token", token)
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
		contentType = "application/json"
	}
	c.Status(resp.StatusCode)
	c.Header("Content-Type", contentType)

	// 非 VOD 链路（如 MPS）保持原始流式透传，不缓冲，避免改变透传语义/增大内存峰值。
	if svcName != "vod" {
		_, _ = io.Copy(c.Writer, resp.Body)
		return
	}

	// 仅 VOD 视频任务链路缓冲响应体，以便旁路记账/镜像（MPS 等不命中 action，自然 no-op）。
	respBytes, readErr := io.ReadAll(resp.Body)
	_, _ = c.Writer.Write(respBytes)
	// 响应体读取失败时跳过，避免基于截断内容误扣费/误镜像。
	if readErr == nil {
		observeTencentVodTask(c, ch, action, body, resp.StatusCode, respBytes)
	}
}

// parseTencentKey splits a channel key formatted as either:
//   - "secretId|secretKey"
//   - "subAppId|secretId|secretKey"  (relay format)
func parseTencentKey(key string) (secretId, secretKey string, err error) {
	parts := strings.Split(strings.TrimSpace(key), "|")
	switch len(parts) {
	case 2:
		if parts[0] == "" || parts[1] == "" {
			return "", "", fmt.Errorf("tencent channel key must be 'secretId|secretKey'")
		}
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), nil
	case 3:
		// subAppId|secretId|secretKey
		if parts[1] == "" || parts[2] == "" {
			return "", "", fmt.Errorf("tencent channel key must be 'subAppId|secretId|secretKey'")
		}
		return strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2]), nil
	default:
		return "", "", fmt.Errorf("tencent channel key format must be 'secretId|secretKey' or 'subAppId|secretId|secretKey'")
	}
}

// tc3Sign computes the TC3-HMAC-SHA256 Authorization header value.
func tc3Sign(secretId, secretKey, host, svcName, action string, body []byte, timestamp int64) string {
	date := time.Unix(timestamp, 0).UTC().Format("2006-01-02")

	canonicalHeaders := "content-type:application/json; charset=utf-8\n" +
		"host:" + host + "\n" +
		"x-tc-action:" + strings.ToLower(action) + "\n"
	signedHeaders := "content-type;host;x-tc-action"

	h := sha256.Sum256(body)
	hashedPayload := hex.EncodeToString(h[:])

	canonicalRequest := "POST\n/\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + hashedPayload

	h2 := sha256.Sum256([]byte(canonicalRequest))
	hashedCanonical := hex.EncodeToString(h2[:])

	credentialScope := date + "/" + svcName + "/tc3_request"
	stringToSign := "TC3-HMAC-SHA256\n" +
		strconv.FormatInt(timestamp, 10) + "\n" +
		credentialScope + "\n" +
		hashedCanonical

	kDate := tc3HMAC([]byte("TC3"+secretKey), date)
	kService := tc3HMAC(kDate, svcName)
	kSigning := tc3HMAC(kService, "tc3_request")
	signature := hex.EncodeToString(tc3HMAC(kSigning, stringToSign))

	return fmt.Sprintf(
		"TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		secretId, credentialScope, signedHeaders, signature,
	)
}

func tc3HMAC(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

// observeTencentVodTask 在 /proxy/tencent/vod 透传成功后旁路记账/镜像。
// 仅对 vod 服务、且 action 命中时动作；任何失败只 SysLog，不影响透传。
func observeTencentVodTask(c *gin.Context, ch *model.Channel, action string, reqBody []byte, status int, respBytes []byte) {
	defer func() {
		if r := recover(); r != nil {
			common.SysLog(fmt.Sprintf("observeTencentVodTask panic: %v", r))
		}
	}()

	switch {
	case isTencentVodCreateAction(action):
		if status < 200 || status >= 300 {
			return
		}
		taskId := extractTencentVodResponseTaskId(respBytes)
		if taskId == "" {
			return
		}
		billAndMirrorTencentVodCreate(c, ch, reqBody, respBytes, taskId)
	case isTencentVodDescribeAction(action):
		mirrorTencentVodPoll(c, reqBody, respBytes)
	}
}
