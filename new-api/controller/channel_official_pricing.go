package controller

import (
	"io"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func SyncChannelOfficialPricing(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var request model.ChannelOfficialSyncOptions
	if err := c.ShouldBindJSON(&request); err != nil && err != io.EOF {
		common.ApiError(c, err)
		return
	}
	result, err := model.SyncChannelOfficialPricing(id, request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
