package apimart

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// toapis.go — toapis.com shares APIMart's unified generation endpoints, but
// some model-specific request bodies differ. Its async task lifecycle also
// uses an OpenAI-style "generation.task" envelope instead of APIMart's
// {code,data} wrapper:
//
//	submit: {"id":"tsk_img_…","object":"generation.task","status":"queued"}
//	poll:   GET /v1/images/generations/{id}
//	        {"status":"completed","result":{"type":"image","data":[{"url":…}]}}
//	        {"status":"failed","error":{"message":"…"}}
//
// The shared SubmitResponse/DetailResponse structs carry the extra flat fields
// (see payload.go); the helpers here detect the envelope and expose a uniform
// view so the sync image adaptor can poll toapis tasks instead of failing the
// submit and retrying on another channel.

// flatPollPathPrefix is the toapis task-status GET path prefix. (APIMart uses
// pollPathPrefix = /v1/tasks/.)
const flatPollPathPrefix = "/v1/images/generations/"
const flatVideoPollPathPrefix = "/v1/videos/generations/"

var tanvaImageAliasPattern = regexp.MustCompile(`@图(\d+)(?:号)?`)

func isToAPISBaseURL(baseURL string) bool {
	base := strings.ToLower(strings.TrimSpace(baseURL))
	return strings.Contains(base, "toapis.com") || strings.Contains(base, "toapis.xyz")
}

// normalizeToAPISKlingOmniPayload translates the APIMart-compatible Kling
// Omni shape emitted by Tanva into ToAPIs' official Omni contract:
//
//   - image inputs live in metadata.image_list
//   - named subjects live in metadata.element_list
//   - prompt references use <<<image_N>>> / <<<element_N>>>
//
// It intentionally runs only after a ToAPIs channel has been selected. The
// original APIMart element_list ({name,description,element_input_urls}) remains
// untouched for APIMart channels.
func normalizeToAPISKlingOmniPayload(payload *SubmitPayload) error {
	if payload == nil || normalizedKlingOmniModel(payload.Model) != "kling-v3-omni" {
		return nil
	}

	if payload.Extras == nil {
		payload.Extras = make(map[string]any)
	}
	extras := payload.Extras

	prompt := payload.Prompt
	if override, ok := extras["prompt"].(string); ok && strings.TrimSpace(override) != "" {
		prompt = override
	}
	delete(extras, "prompt")

	metadata := mapFromAny(extras["metadata"])
	if metadata == nil {
		metadata = make(map[string]any)
	}

	imageList := normalizeToAPISImageList(metadata["image_list"])
	if len(imageList) == 0 {
		imageList = normalizeToAPISImageList(extras["image_list"])
	}
	if len(imageList) == 0 {
		imageList = normalizeToAPISImageWithRoles(extras["image_with_roles"])
	}
	if len(imageList) == 0 {
		imageList = normalizeToAPISImageWithRoles(payload.ImageWithRoles)
	}
	if len(imageList) == 0 {
		imageURLs := append([]string(nil), stringsFromAny(extras["image_urls"])...)
		imageURLs = append(imageURLs, payload.ImageUrls...)
		for _, rawURL := range uniqueStrings(imageURLs) {
			if rawURL = strings.TrimSpace(rawURL); rawURL != "" {
				imageList = append(imageList, map[string]any{"image_url": rawURL})
			}
		}
	}

	elementList, elementNames, err := normalizeToAPISElementList(metadata["element_list"])
	if err != nil {
		return err
	}
	if len(elementList) == 0 {
		elementList, elementNames, err = normalizeToAPISElementList(extras["element_list"])
		if err != nil {
			return err
		}
	}

	for i, name := range elementNames {
		if name == "" {
			continue
		}
		prompt = replaceNamedOmniAlias(prompt, name, omniPlaceholder("element", i+1))
	}
	prompt = tanvaImageAliasPattern.ReplaceAllStringFunc(prompt, func(alias string) string {
		matches := tanvaImageAliasPattern.FindStringSubmatch(alias)
		if len(matches) != 2 {
			return alias
		}
		index, parseErr := strconv.Atoi(matches[1])
		if parseErr != nil || index < 1 {
			return alias
		}
		if index <= len(imageList) {
			return omniPlaceholder("image", index)
		}
		// Tanva's elementImg edge historically remained labelled @图N in the
		// authored prompt even though the same asset was sent as element_list.
		// When no ordinary images exist, bind that alias to the element by order.
		if len(imageList) == 0 && index <= len(elementList) {
			return omniPlaceholder("element", index)
		}
		return alias
	})

	requiredPlaceholders := make([]string, 0, len(imageList)+len(elementList))
	for i := range imageList {
		requiredPlaceholders = append(requiredPlaceholders, omniPlaceholder("image", i+1))
	}
	for i := range elementList {
		requiredPlaceholders = append(requiredPlaceholders, omniPlaceholder("element", i+1))
	}
	prompt = ensureOmniPlaceholders(prompt, requiredPlaceholders)
	prompt = collapseAdjacentOmniPlaceholders(prompt, len(imageList), len(elementList))

	if len(imageList) > 0 {
		metadata["image_list"] = imageList
	} else {
		delete(metadata, "image_list")
	}
	if len(elementList) > 0 {
		metadata["element_list"] = elementList
	} else {
		delete(metadata, "element_list")
	}

	payload.Prompt = strings.TrimSpace(prompt)
	payload.ImageUrls = nil
	payload.ImageWithRoles = nil
	// ToAPIs uses mode to select 720P/1080P for Kling Omni; resolution is not
	// part of this model's request schema.
	payload.Resolution = ""
	for _, key := range []string{
		"image_urls", "image_list", "image_with_roles", "element_list", "resolution", "metadata",
	} {
		delete(extras, key)
	}
	if len(metadata) > 0 {
		extras["metadata"] = metadata
	}
	if len(extras) == 0 {
		payload.Extras = nil
	}
	return nil
}

func normalizedKlingOmniModel(model string) string {
	base := strings.ToLower(strings.TrimSpace(model))
	for _, suffix := range []string{"-apimart", "-toapis", "-suchuang", "-all"} {
		base = strings.TrimSuffix(base, suffix)
	}
	return base
}

func normalizeToAPISImageList(value any) []map[string]any {
	items := mapsFromAny(value)
	out := make([]map[string]any, 0, len(items))
	seen := make(map[string]bool)
	for _, item := range items {
		rawURL := firstNonEmptyString(item, "image_url", "url", "image")
		if rawURL == "" || seen[rawURL] {
			continue
		}
		seen[rawURL] = true
		normalized := map[string]any{"image_url": rawURL}
		if imageType := normalizeToAPISImageType(firstNonEmptyString(item, "type", "role")); imageType != "" {
			normalized["type"] = imageType
		}
		out = append(out, normalized)
	}
	return out
}

func normalizeToAPISImageWithRoles(value any) []map[string]any {
	return normalizeToAPISImageList(value)
}

func normalizeToAPISImageType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "first_frame", "first-frame", "first":
		return "first_frame"
	case "last_frame", "last-frame", "end_frame", "end-frame", "last", "end":
		return "end_frame"
	default:
		return ""
	}
}

func normalizeToAPISElementList(value any) ([]map[string]any, []string, error) {
	items := mapsFromAny(value)
	out := make([]map[string]any, 0, len(items))
	names := make([]string, 0, len(items))
	seen := make(map[string]bool)
	for i, item := range items {
		rawURL := firstNonEmptyString(item, "url")
		if rawURL == "" {
			urls := stringsFromAny(item["element_input_urls"])
			if len(urls) > 0 {
				rawURL = strings.TrimSpace(urls[0])
			}
		}
		if rawURL == "" {
			return nil, nil, fmt.Errorf("toapis kling omni element_list[%d] has no usable url", i)
		}
		if seen[rawURL] {
			continue
		}
		seen[rawURL] = true
		elementType := firstNonEmptyString(item, "type")
		if elementType == "" {
			elementType = "image"
		}
		role := firstNonEmptyString(item, "role")
		if role == "" {
			role = "subject"
		}
		out = append(out, map[string]any{
			"url":  rawURL,
			"type": elementType,
			"role": role,
		})
		names = append(names, firstNonEmptyString(item, "name"))
	}
	return out, names, nil
}

func mapFromAny(value any) map[string]any {
	switch item := value.(type) {
	case map[string]any:
		copyMap := make(map[string]any, len(item))
		for key, nested := range item {
			copyMap[key] = nested
		}
		return copyMap
	default:
		return nil
	}
}

func mapsFromAny(value any) []map[string]any {
	switch items := value.(type) {
	case []map[string]any:
		return items
	case []any:
		out := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if mapped, ok := item.(map[string]any); ok {
				out = append(out, mapped)
			}
		}
		return out
	default:
		return nil
	}
}

func firstNonEmptyString(item map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := item[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func omniPlaceholder(kind string, index int) string {
	return fmt.Sprintf("<<<%s_%d>>>", kind, index)
}

func replaceNamedOmniAlias(prompt, name, placeholder string) string {
	alias := "@" + name
	searchFrom := 0
	for searchFrom < len(prompt) {
		relative := strings.Index(prompt[searchFrom:], alias)
		if relative < 0 {
			break
		}
		start := searchFrom + relative
		end := start + len(alias)
		if end < len(prompt) && isASCIIIdentifierByte(prompt[end]) {
			searchFrom = end
			continue
		}
		prompt = prompt[:start] + placeholder + prompt[end:]
		searchFrom = start + len(placeholder)
	}
	return prompt
}

func isASCIIIdentifierByte(value byte) bool {
	return value == '_' || value >= '0' && value <= '9' || value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z'
}

func ensureOmniPlaceholders(prompt string, placeholders []string) string {
	missing := make([]string, 0, len(placeholders))
	for _, placeholder := range placeholders {
		if !strings.Contains(prompt, placeholder) {
			missing = append(missing, placeholder)
		}
	}
	if len(missing) == 0 {
		return prompt
	}
	prefix := strings.Join(missing, " ")
	if strings.TrimSpace(prompt) == "" {
		return prefix
	}
	return prefix + " " + strings.TrimSpace(prompt)
}

func collapseAdjacentOmniPlaceholders(prompt string, imageCount, elementCount int) string {
	for kind, count := range map[string]int{"image": imageCount, "element": elementCount} {
		for i := 1; i <= count; i++ {
			placeholder := omniPlaceholder(kind, i)
			pattern := regexp.MustCompile(regexp.QuoteMeta(placeholder) + `\s+` + regexp.QuoteMeta(placeholder))
			for pattern.MatchString(prompt) {
				prompt = pattern.ReplaceAllString(prompt, placeholder)
			}
		}
	}
	return prompt
}

// FlatPollPath returns the toapis GET status path for a task id.
func FlatPollPath(taskID string) string { return flatPollPathPrefix + taskID }

// FlatVideoPollPath returns the ToAPIs video task-status path.
func FlatVideoPollPath(taskID string) string { return flatVideoPollPathPrefix + taskID }

// IsFlat reports whether the submit response is the toapis flat form (task id
// at the top level, no `code`/`data` wrapper).
func (s *SubmitResponse) IsFlat() bool {
	if s == nil {
		return false
	}
	return s.Object == "generation.task" || (s.Code == 0 && len(s.Data) == 0 && s.ID != "")
}

// Accepted reports whether the submit succeeded with a usable task id, across
// both the APIMart ({code:200,data:[…]}) and toapis (flat) envelopes.
func (s *SubmitResponse) Accepted() bool {
	if s == nil || s.TaskID() == "" {
		return false
	}
	if s.IsFlat() {
		return true // toapis has no `code`; a top-level id+status means accepted
	}
	return s.Code == 200
}

// isFlat reports whether a poll response is the toapis flat form.
func (d *DetailResponse) isFlat() bool {
	if d == nil {
		return false
	}
	return d.Object == "generation.task" || (d.Code == 0 && d.Data == nil && (d.ID != "" || d.Status != ""))
}

// Ready reports whether the poll response carries a parseable task payload
// (APIMart: code==200 && data!=nil; toapis: flat with a status).
func (d *DetailResponse) Ready() bool {
	if d == nil {
		return false
	}
	if d.isFlat() {
		return d.EffectiveStatus() != ""
	}
	return d.Code == 200 && d.Data != nil
}

// EffectiveStatus returns the task status across both envelopes.
func (d *DetailResponse) EffectiveStatus() string {
	if d == nil {
		return ""
	}
	if d.Data != nil {
		return d.Data.Status
	}
	return d.Status
}

// EffectiveProgress returns the 0..100 progress across both envelopes.
func (d *DetailResponse) EffectiveProgress() int {
	if d == nil {
		return 0
	}
	if d.Data != nil {
		return d.Data.Progress
	}
	return d.Progress
}
