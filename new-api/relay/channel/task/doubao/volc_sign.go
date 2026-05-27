package doubao

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const (
	volcHost    = "open.volcengineapi.com"
	volcRegion  = "cn-beijing"
	volcService = "ark"
	volcVersion = "2024-01-01"
	volcProject = "default"
)

type volcSignedRequest struct {
	URL     string
	Headers map[string]string
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

func volcSign(accessKey, secretKey, action, bodyJSON string) volcSignedRequest {
	now := time.Now().UTC()
	iso := now.Format("20060102T150405Z")
	short := now.Format("20060102")

	canonicalQuery := fmt.Sprintf("Action=%s&Version=%s", action, volcVersion)
	bodyHash := sha256Hex(bodyJSON)
	contentType := "application/json; charset=utf-8"

	canonicalHeaders := fmt.Sprintf(
		"content-type:%s\nhost:%s\nx-content-sha256:%s\nx-date:%s\n",
		contentType, volcHost, bodyHash, iso,
	)
	signedHeaders := "content-type;host;x-content-sha256;x-date"

	canonicalRequest := strings.Join([]string{
		"POST",
		"/",
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		bodyHash,
	}, "\n")

	credentialScope := fmt.Sprintf("%s/%s/%s/request", short, volcRegion, volcService)
	stringToSign := strings.Join([]string{
		"HMAC-SHA256",
		iso,
		credentialScope,
		sha256Hex(canonicalRequest),
	}, "\n")

	kDate := hmacSHA256([]byte(secretKey), short)
	kRegion := hmacSHA256(kDate, volcRegion)
	kService := hmacSHA256(kRegion, volcService)
	kSigning := hmacSHA256(kService, "request")

	sig := hex.EncodeToString(hmacSHA256(kSigning, stringToSign))
	auth := fmt.Sprintf(
		"HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey, credentialScope, signedHeaders, sig,
	)

	return volcSignedRequest{
		URL: fmt.Sprintf("https://%s/?%s", volcHost, canonicalQuery),
		Headers: map[string]string{
			"Content-Type":     contentType,
			"X-Date":           iso,
			"X-Content-Sha256": bodyHash,
			"Authorization":    auth,
		},
	}
}
