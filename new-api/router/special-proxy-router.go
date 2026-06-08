package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

// SetSpecialProxyRouter registers transparent pass-through routes for upstream
// APIs that use non-standard paths or auth mechanisms.
//
// Route layout:
//   /minimaxi/v1/*path      → kapon channel          (minimax TTS, fixed path prefix)
//   /v1/music_generation    → minimax-music channel  (minimax music, fixed path)
//   /youchuan/*path         → youchuan channel       (x-youchuan-app/secret auth)
//   /proxy/:name/*path      → GenericChannelProxy    (Bearer, looks up channel by name)
//
// The /proxy/tencent/* routes (TC3 signing) are registered separately in
// tencent-proxy-router.go; Gin gives static "tencent" priority over :name param.
func SetSpecialProxyRouter(router *gin.Engine) {
	// Minimax speech (kapon proxy): /minimaxi/v1/* → models.kapon.cloud/minimaxi/v1/*
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

	// Youchuan (Midjourney V7 / Niji 7): /youchuan/*path → ali.youchuan.cn/*path
	// Injects x-youchuan-app / x-youchuan-secret (from the "youchuan" channel key
	// stored as "appId|secret") instead of Bearer, so the backend's youchuan-mode
	// requests (e.g. /v1/tob/diffusion, /v1/tob/job/{id}) get the right upstream auth.
	youchuanGroup := router.Group("/youchuan")
	youchuanGroup.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		youchuanGroup.Any("/*path", controller.ProxyYouchuan)
	}

	// Generic channel proxy: /proxy/:name/*path
	// Channel name is taken directly from the URL, e.g.:
	//   /proxy/ark/*      → ark channel    (Doubao Seed3D + Seedream5)
	//   /proxy/watcha/*   → watcha channel (Watcha Seedream5)
	//   /proxy/remove-bg/* → remove-bg channel (remove.bg, X-Api-Key auth)
	// Gin prefers the static "tencent" segment over :name, so /proxy/tencent/* is safe.
	proxyGroup := router.Group("/proxy")
	proxyGroup.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		proxyGroup.Any("/:name/*path", controller.GenericChannelProxy)
	}
}
