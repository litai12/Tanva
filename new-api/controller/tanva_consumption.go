package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetTanvaConsumption(c *gin.Context) {
	id := c.Param("orderId")
	if id != c.GetHeader("X-Tanva-Order-Id") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanva_order_identity_conflict"})
		return
	}
	o, err := model.GetTanvaConsumption(c.GetInt("id"), c.GetInt("token_id"), id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "tanva_order_not_found"})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tanva_receipt_unavailable"})
		}
		return
	}
	if o.OrderHash != c.GetHeader("X-Tanva-Order-Hash") {
		c.JSON(http.StatusConflict, gin.H{"error": "tanva_order_identity_conflict"})
		return
	}
	envelope, err := service.TanvaReceiptEnvelope(o)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	c.JSON(http.StatusOK, envelope)
}
