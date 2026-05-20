package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

// SetSpecialProxyRouter registers transparent pass-through routes for upstream
// APIs that use non-standard paths (minimax speech, minimax music, ark seed3d).
// Each route authenticates the caller via TokenAuth and then forwards to the
// corresponding channel's upstream URL — without invoking channel distribution.
func SetSpecialProxyRouter(router *gin.Engine) {
	// Minimax speech (kapon): /minimaxi/v1/* → models.kapon.cloud/minimaxi/v1/*
	kaponGroup := router.Group("/minimaxi/v1")
	kaponGroup.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		kaponGroup.Any("/*path", controller.ProxyKaponSpeech)
	}

	// Minimax music: POST /v1/music_generation → api.minimaxi.com/v1/music_generation
	musicGroup := router.Group("/v1")
	musicGroup.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		musicGroup.POST("/music_generation", controller.ProxyMinimaxMusic)
	}

	// Ark seed3d: /proxy/ark/* → ark.cn-beijing.volces.com/api/v3/*
	arkGroup := router.Group("/proxy/ark")
	arkGroup.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		arkGroup.Any("/*path", controller.ProxyArkSeed3D)
	}
}
