package vidu

import "testing"

// text2video 端点的模型名规则（docs.kapon.cloud/vidu/video-generation）：
// Q3 系列只有 viduq3-pro / viduq3-turbo（没有裸 viduq3，去后缀会被上游拒收
// "model viduq3 does not support text2video"）；Q2 及更早系列相反，只接受
// 基础模型名，必须去掉 pro/turbo 后缀。
func TestNormalizeTextToVideoModel(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in   string
		want string
	}{
		{"viduq3-pro", "viduq3-pro"},
		{"viduq3-turbo", "viduq3-turbo"},
		{"viduq2-pro", "viduq2"},
		{"viduq2-turbo", "viduq2"},
		{"viduq2", "viduq2"},
		{"viduq1", "viduq1"},
	}
	for _, c := range cases {
		if got := normalizeTextToVideoModel(c.in); got != c.want {
			t.Errorf("normalizeTextToVideoModel(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
