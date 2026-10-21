package controller

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestDashboardModelCandidatesConfiguredChannels(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "candidates.sqlite")), &gorm.Config{})
	require.NoError(t, err)
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	// A narrow fixture also proves these endpoints do not need credentials,
	// abilities, enabled status, or model metadata to offer configured models.
	require.NoError(t, db.Exec("CREATE TABLE channels (id INTEGER PRIMARY KEY, type INTEGER, models TEXT, status INTEGER)").Error)
	require.NoError(t, db.Table("channels").Create([]map[string]interface{}{
		{"id": 9, "type": 59, "status": 2, "models": " configured-disabled-only,gemini-nano-banana-2.1,gemini-nano-banana-2.1-official,gpt-image-2-apimart,,configured-disabled-only "},
		{"id": 31, "type": 59, "status": 1, "models": "configured-disabled-only,gpt-image-2,gpt-image-2.5-flare-vip"},
		{"id": 50, "type": 1, "status": 1, "models": "configured-openai-only,gpt-image-2.5-flare-vip"},
	}).Error)

	staticAll, err := common.Marshal(openAIModels)
	require.NoError(t, err)
	staticByType, err := common.Marshal(channelId2Models)
	require.NoError(t, err)
	previousMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(previousMode) })
	router := gin.New()
	router.GET("/api/models", DashboardListModels)
	router.GET("/api/channel/models", ChannelListModels)
	request := func(path string, target interface{}) {
		t.Helper()
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		require.Equal(t, http.StatusOK, response.Code)
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), target))
	}

	var byTypeResponse struct {
		Success bool             `json:"success"`
		Data    map[int][]string `json:"data"`
	}
	request("/api/models", &byTypeResponse)
	require.True(t, byTypeResponse.Success)
	for _, name := range []string{"configured-disabled-only", "gemini-nano-banana-2.1", "gemini-nano-banana-2.1-official", "gpt-image-2", "gpt-image-2.5-flare-vip"} {
		require.Contains(t, byTypeResponse.Data[59], name)
	}
	require.NotContains(t, byTypeResponse.Data[59], "configured-openai-only")
	require.NotContains(t, byTypeResponse.Data[59], "gpt-image-2-apimart")
	require.Contains(t, byTypeResponse.Data[1], "configured-openai-only")
	require.NotContains(t, byTypeResponse.Data[1], "configured-disabled-only")
	for channelType, names := range byTypeResponse.Data {
		seen := map[string]bool{}
		for _, name := range names {
			require.False(t, seen[name], "duplicate %q in channel type %d", name, channelType)
			seen[name] = true
		}
	}

	var allResponse struct {
		Success bool               `json:"success"`
		Data    []dto.OpenAIModels `json:"data"`
	}
	request("/api/channel/models", &allResponse)
	require.True(t, allResponse.Success)
	seen := map[string]bool{}
	for _, entry := range allResponse.Data {
		require.False(t, seen[entry.Id], "duplicate global candidate %q", entry.Id)
		seen[entry.Id] = true
	}
	for _, name := range []string{"configured-disabled-only", "configured-openai-only", "gemini-nano-banana-2.1", "gemini-nano-banana-2.1-official"} {
		require.True(t, seen[name], "missing global candidate %q", name)
	}

	// Neither endpoint may append dynamic records to the relay's static lists.
	currentAll, err := common.Marshal(openAIModels)
	require.NoError(t, err)
	currentByType, err := common.Marshal(channelId2Models)
	require.NoError(t, err)
	require.Equal(t, string(staticAll), string(currentAll))
	require.Equal(t, string(staticByType), string(currentByType))
	var status int
	require.NoError(t, db.Table("channels").Select("status").Where("id = ?", 9).Scan(&status).Error)
	require.Equal(t, 2, status, "offering a disabled channel's models must not enable it")

	// The next request must reflect edits immediately without a restart or stale
	// cached additions from either endpoint.
	require.NoError(t, db.Table("channels").Where("id IN ?", []int{9, 31}).Update("models", "").Error)
	request("/api/models", &byTypeResponse)
	require.NotContains(t, byTypeResponse.Data[59], "configured-disabled-only")
	require.True(t, reflect.DeepEqual(channelId2Models[59], byTypeResponse.Data[59]))
	request("/api/channel/models", &allResponse)
	require.False(t, slices.ContainsFunc(allResponse.Data, func(entry dto.OpenAIModels) bool { return entry.Id == "configured-disabled-only" }))

	require.NoError(t, db.Exec("DROP TABLE channels").Error)
	for _, path := range []string{"/api/models", "/api/channel/models"} {
		var response struct {
			Success bool `json:"success"`
		}
		request(path, &response)
		require.False(t, response.Success, "a failed configuration read must be explicit")
	}
}
