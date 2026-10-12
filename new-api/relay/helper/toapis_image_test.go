package helper

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestToAPISImageActualPreConsumptionMatchesRetailMatrix(t *testing.T) {
	oldPrices := ratio_setting.ModelPrice2JSONString()
	oldGroups := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() {
		_ = ratio_setting.UpdateModelPriceByJSONString(oldPrices)
		_ = ratio_setting.UpdateGroupRatioByJSONString(oldGroups)
	})
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"gpt-image-2.5-flare-vip":0.2,"gpt-image-2.5-sunburst-vip":0.2,"gemini-nano-banana-2.1":0.2,"gemini-nano-banana-2.1-official":0.3}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1}`))
	prices := map[string][3]float64{"low": {.2, .3, .4}, "medium": {.3, .4, .5}, "high": {.4, .6, .8}, "xhigh": {.6, 1, 1.4}, "max": {1.5, 3, 4.5}}
	for _, model := range []string{"gpt-image-2.5-flare-vip", "gpt-image-2.5-sunburst-vip", "gemini-nano-banana-2.1", "gemini-nano-banana-2.1-official"} {
		matrix := prices
		if model == "gemini-nano-banana-2.1" {
			matrix = map[string][3]float64{"": {.2, .3, .4}}
		}
		if model == "gemini-nano-banana-2.1-official" {
			matrix = map[string][3]float64{"": {.3, .6, .9}}
		}
		for quality, row := range matrix {
			for index, resolution := range []string{"1K", "2K", "4K"} {
				t.Run(model+"/"+quality+"/"+resolution, func(t *testing.T) {
					request, err := dto.NormalizeToAPISImageRequest(dto.ImageRequest{Model: model, Size: "1:1", Quality: quality, Extra: map[string]json.RawMessage{"resolution": json.RawMessage(fmt.Sprintf("%q", resolution))}})
					require.NoError(t, err)
					c, _ := gin.CreateTestContext(httptest.NewRecorder())
					info := &relaycommon.RelayInfo{OriginModelName: model, UserGroup: "default", UsingGroup: "default"}
					price, err := ModelPriceHelper(c, info, 1, request.GetTokenCountMeta())
					require.NoError(t, err)
					require.True(t, price.UsePrice)
					require.InDelta(t, row[index], price.ModelPrice, 1e-12)
					require.Equal(t, int(row[index]*common.QuotaPerUnit), price.QuotaToPreConsume)
				})
			}
		}
	}
}

func TestToAPISImageHTTPValidationNormalizesBeforePricing(t *testing.T) {
	for _, raw := range []string{
		`{"model":"gpt-image-2.5-flare-vip","prompt":"test","size":"1:1","quality":"auto","resolution":"2K"}`,
		`{"model":"gemini-nano-banana-2.1","prompt":"test","metadata":{"resolution":"4K"}}`,
		`{"model":"gemini-nano-banana-2.1-official","prompt":"test","metadata":{"resolution":"4K"}}`,
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/images/generations", strings.NewReader(raw))
		c.Request.Header.Set("Content-Type", "application/json")
		request, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
		require.NoError(t, err)
		require.Equal(t, uint(1), *request.N)
		if request.Model == "gpt-image-2.5-flare-vip" {
			require.Equal(t, "2048x2048", request.Size)
			require.Equal(t, "high", request.Quality)
		}
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/images/generations", strings.NewReader(`{"model":"gpt-image-2.5-flare-vip","prompt":"test","n":0}`))
	c.Request.Header.Set("Content-Type", "application/json")
	_, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
	require.ErrorContains(t, err, "n must be 1")
}
