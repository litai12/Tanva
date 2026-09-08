package service

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestRemoteTokenEstimateDoesNotDownloadMedia(t *testing.T) {
	beforeCount, beforeMedia, beforeNonStream := constant.CountToken, constant.GetMediaToken, constant.GetMediaTokenNotStream
	constant.CountToken, constant.GetMediaToken, constant.GetMediaTokenNotStream = true, true, true
	t.Cleanup(func() {
		constant.CountToken, constant.GetMediaToken, constant.GetMediaTokenNotStream = beforeCount, beforeMedia, beforeNonStream
	})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); http.Error(w, "must not download", 500) }))
	defer server.Close()
	for _, kind := range []types.FileType{types.FileTypeImage, ""} {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Request = httptest.NewRequest(http.MethodPost, "/", nil)
		common.SetContextKey(ctx, constant.ContextKeyOriginalModel, "gpt-4o")
		meta := &types.TokenCountMeta{TokenType: types.TokenTypeTextNumber, Files: []*types.FileMeta{types.NewFileMeta(kind, types.NewURLFileSource(server.URL+"/image.png"))}}
		tokens, err := EstimateRequestToken(ctx, meta, &relaycommon.RelayInfo{RelayFormat: types.RelayFormatOpenAI})
		require.NoError(t, err)
		if kind == types.FileTypeImage {
			require.Equal(t, 523, tokens)
		} else {
			require.Equal(t, 4099, tokens)
		}
	}
	require.Zero(t, requests.Load())
}
