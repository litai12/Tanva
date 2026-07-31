package volcengine

import "testing"

func TestModelListUsesSupportedDoubaoSeed20Versions(t *testing.T) {
	models := make(map[string]bool, len(ModelList))
	for _, model := range ModelList {
		models[model] = true
	}

	for _, model := range []string{
		"doubao-seed-2-0-mini-260428",
		"doubao-seed-2-0-lite-260428",
		"doubao-seed-2-0-pro-260215",
	} {
		if !models[model] {
			t.Errorf("ModelList does not contain %s", model)
		}
	}

	if models["doubao-seed-2-0-pro-260428"] {
		t.Error("ModelList exposes unsupported doubao-seed-2-0-pro-260428")
	}
}
