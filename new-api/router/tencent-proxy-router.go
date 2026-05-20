package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

// SetTencentProxyRouter registers signing-proxy routes for Tencent Cloud APIs.
// The backend sends raw Tencent API payloads with X-TC-Action / X-TC-Version /
// X-TC-Region headers; new-api resolves credentials from the named channel,
// adds TC3-HMAC-SHA256 Authorization, and forwards to the upstream endpoint.
func SetTencentProxyRouter(router *gin.Engine) {
	tencentGroup := router.Group("/proxy/tencent")
	tencentGroup.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		// POST /proxy/tencent/mps → mps.tencentcloudapi.com
		tencentGroup.POST("/mps", controller.ProxyTencentMPS)
		// POST /proxy/tencent/vod → vod.tencentcloudapi.com
		tencentGroup.POST("/vod", controller.ProxyTencentVOD)
	}
}
