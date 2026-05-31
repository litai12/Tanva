package controller

import "testing"

func TestComputeTencentVodCredits(t *testing.T) {
	cases := []struct {
		name string
		in   tencentVodCreatePayload
		want int
	}{
		{"vidu q3 参考时长1080P", tencentVodCreatePayload{"Vidu", "q3", 8, "1080P", "Disabled"}, 1080}, // 600 * (8/8) * 1.8
		{"vidu q2 默认5s720P", tencentVodCreatePayload{"Vidu", "q2", 5, "720P", "Disabled"}, 600},    // 600 * 1 * 1
		{"seedance 2.0-pro 5s720P", tencentVodCreatePayload{"Seedance", "2.0-pro", 5, "720P", "Disabled"}, 1100},
		{"seedance 2.0-mini 5s480P", tencentVodCreatePayload{"Seedance", "2.0-mini", 5, "480P", "Disabled"}, 300}, // 500 * 1 * 0.6
		{"未知模型走兜底600", tencentVodCreatePayload{"Whatever", "x", 5, "720P", ""}, 600},
		{"大小写不敏感", tencentVodCreatePayload{"vidu", "Q2", 5, "720p", ""}, 600},
		{"时长0按系数1", tencentVodCreatePayload{"Vidu", "q2", 0, "720P", ""}, 600},
	}
	for _, c := range cases {
		if got := computeTencentVodCredits(c.in); got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}
}

func TestTencentVodQuota(t *testing.T) {
	if got := tencentVodQuota(600); got != 3_000_000 {
		t.Fatalf("got %d want 3000000", got)
	}
	if got := tencentVodQuota(0); got != 0 {
		t.Fatalf("got %d want 0", got)
	}
}

func TestTencentVodDisplayModel(t *testing.T) {
	if got := tencentVodDisplayModel("Vidu", "q3"); got != "vidu-q3" {
		t.Fatalf("got %q", got)
	}
	if got := tencentVodDisplayModel("Seedance", "2.0-pro"); got != "seedance-2.0-pro" {
		t.Fatalf("got %q", got)
	}
	if got := tencentVodDisplayModel("", ""); got != "tencent-vod-video" {
		t.Fatalf("got %q", got)
	}
}

func TestTencentVodActionPredicates(t *testing.T) {
	if !isTencentVodCreateAction("CreateAigcVideoTask") || !isTencentVodCreateAction("createaigcvideotask") {
		t.Fatal("create predicate failed")
	}
	if !isTencentVodDescribeAction("DescribeTaskDetail") {
		t.Fatal("describe predicate failed")
	}
	if isTencentVodCreateAction("DescribeTaskDetail") {
		t.Fatal("create predicate false positive")
	}
}

func TestParseTencentVodCreatePayload(t *testing.T) {
	body := []byte(`{"ModelName":"Vidu","ModelVersion":"q3","OutputConfig":{"Duration":8,"Resolution":"1080P","AspectRatio":"16:9","AudioGeneration":"Disabled"}}`)
	p, ok := parseTencentVodCreatePayload(body)
	if !ok {
		t.Fatal("expected ok")
	}
	if p.ModelName != "Vidu" || p.ModelVersion != "q3" || p.Duration != 8 || p.Resolution != "1080P" || p.Audio != "Disabled" {
		t.Fatalf("bad parse: %+v", p)
	}
}
