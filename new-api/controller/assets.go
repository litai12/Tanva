package controller

import (
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/task/doubao"
	"github.com/gin-gonic/gin"
)

type createAssetRequest struct {
	SourceURL string `json:"source_url" binding:"required"`
	Type      string `json:"type"`
}

type assetResponse struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	CreatedAt int64  `json:"created_at"`
}

func findARKCredentials() (accessKey, secretKey string, err error) {
	var channels []model.Channel
	if err = model.DB.Where("type = ? AND status = 1", constant.ChannelTypeDoubao).Find(&channels).Error; err != nil {
		return "", "", err
	}
	for i := range channels {
		s := channels[i].GetOtherSettings()
		if s.VolcAccessKey != "" && s.VolcSecretKey != "" {
			return s.VolcAccessKey, s.VolcSecretKey, nil
		}
	}
	return "", "", fmt.Errorf("no active Doubao channel with ARK AK/SK configured")
}

func CreateAssetHandler(c *gin.Context) {
	var req createAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"message": err.Error(), "type": "invalid_request_error"},
		})
		return
	}

	ak, sk, err := findARKCredentials()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": gin.H{"message": err.Error(), "type": "server_error"},
		})
		return
	}

	assetID, err := doubao.UploadAsset(ak, sk, req.SourceURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"message": err.Error(), "type": "server_error"},
		})
		return
	}

	c.JSON(http.StatusOK, assetResponse{
		ID:        assetID,
		Status:    "active",
		CreatedAt: time.Now().Unix(),
	})
}

func GetAssetStatusHandler(c *gin.Context) {
	assetID := c.Param("id")
	if assetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"message": "asset id is required", "type": "invalid_request_error"},
		})
		return
	}

	ak, sk, err := findARKCredentials()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": gin.H{"message": err.Error(), "type": "server_error"},
		})
		return
	}

	status, err := doubao.QueryAssetStatus(ak, sk, assetID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"message": err.Error(), "type": "server_error"},
		})
		return
	}

	c.JSON(http.StatusOK, assetResponse{
		ID:        assetID,
		Status:    status,
		CreatedAt: 0,
	})
}
