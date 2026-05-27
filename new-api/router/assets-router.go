package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

func SetAssetsRouter(router *gin.Engine) {
	assetsV1Router := router.Group("/v1")
	assetsV1Router.Use(middleware.RouteTag("relay"))
	assetsV1Router.Use(middleware.TokenAuth())
	{
		assetsV1Router.POST("/assets", controller.CreateAssetHandler)
		assetsV1Router.GET("/assets/:id", controller.GetAssetStatusHandler)
	}
}
